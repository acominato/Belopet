/***************
 * CalculadoraMotor.gs â€” BeloPet
 * Motor centralizado para cÃ¡lculo de orÃ§amento
 * Modalidades: compartilhado, exclusivo e duplo
 * Uso recomendado: publicar esta calculadora pelo prÃ³prio Apps Script (HTMLService),
 * para o HTML chamar google.script.run sem problema de CORS.
 ***************/

const BP_CALC = {
  BASE_EXCLUSIVO: "SÃ£o Bernardo do Campo SP",
  VALOR_KM_EXCLUSIVO: 2.15,
  ADICIONAL_POR_PET_EXCLUSIVO: 100,
  MIN_COMPARTILHADO: 500,
  TETO_GATO_FILHOTE: 1500,
  TETO_CAO_ADULTO: 2500,
  ADICIONAL_GO_DF_INTERIOR: 600,
  ADICIONAL_PETROLINA: 400,
  CRM_WEBAPP_URL: "https://script.google.com/macros/s/AKfycbxyMvE7rxDtx96xgar11ekx3T2u50sJEi-xlQAGqXnzwpRnt1a_qzf900yWh3OolpIi/exec"
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile("Calculadora")
    .setTitle("BeloPet â€” Calculadora")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function BP_calcularOrcamento(payload) {
  try {
    payload = payload || {};
    const texto = String(payload.texto || "").trim();
    const modalidadeForcada = BP_norm_(payload.modalidade || "");
    const apiKey = String(payload.openaiKey || PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY") || "").trim();

    if (!texto) throw new Error("Texto do cliente vazio.");
    if (!apiKey) throw new Error("Chave OpenAI ausente. Configure no campo da tela ou em Script Properties como OPENAI_API_KEY.");

    const ia = BP_interpretarComOpenAI_(texto, apiKey);
    const dados = BP_normalizarDados_(texto, ia, modalidadeForcada);
    const rota = BP_calcularRotas_(dados.origem, dados.destino);
    dados.km = rota.principal.km;

    if (!rota.principal.km || rota.principal.km <= 0) {
      dados.inconsistencias.push("NÃ£o foi possÃ­vel calcular a distÃ¢ncia origem â†’ destino.");
    }
    if ((dados.modalidade === "exclusivo" || dados.modalidade === "duplo") && !rota.exclusivo.ok) {
      dados.inconsistencias.push("KM exclusivo incompleto/suspeito. Conferir trechos antes de enviar.");
    }

    const compartilhado = BP_calcularCompartilhado_(dados, rota);
    const exclusivo = BP_calcularExclusivo_(dados, rota, Number(payload.pedagio || ia.pedagioEstimado || 0));
    const mensagemWhatsApp = BP_montarMensagem_(dados, compartilhado, exclusivo, rota);
    const diagnostico = BP_montarDiagnostico_(dados, rota, compartilhado, exclusivo);

    const crm = BP_montarPayloadCRM_(payload, dados, compartilhado, exclusivo, mensagemWhatsApp);
    if (payload.salvarCRM !== false) BP_salvarCRM_(crm);

    return {
      ok: true,
      dados: dados,
      rota: rota,
      compartilhado: compartilhado,
      exclusivo: exclusivo,
      diagnostico: diagnostico,
      mensagemWhatsApp: mensagemWhatsApp,
      crm: crm
    };
  } catch (e) {
    return { ok: false, message: e && e.message ? e.message : String(e) };
  }
}

function BP_interpretarComOpenAI_(texto, apiKey) {
  const prompt = [
    "VocÃª Ã© o interpretador oficial do sistema BeloPet.",
    "Responda EXCLUSIVAMENTE com JSON vÃ¡lido, sem markdown.",
    "Extraia SOMENTE dados presentes no texto. NÃ£o invente idade, raÃ§a, telefone, data ou valor.",
    "Modalidade: compartilhado, exclusivo ou duplo. Se nÃ£o constar, use compartilhado.",
    "Origem e destino: cidade + UF quando houver. Nunca use bairro como cidade se a cidade estiver clara.",
    "Pets: OBRIGATÃ“RIO devolver array pets, com um item por grupo de animais.",
    "Cada item de pets deve ter: quantidade, especie ('cao' ou 'gato'), raca, idade, pesoKg, porte (PP/P/M/G/GG), filhote (true/false).",
    "Todo gato Ã© especie gato, porte M para cÃ¡lculo, mesmo adulto.",
    "CÃ£o SRD/vira-lata sem porte explÃ­cito: use M, mas se houver peso, estime: atÃ© 6kg P, 7-18kg M, 19-35kg G, acima GG.",
    "RaÃ§as caninas mesmo com grafia errada devem ser especie cao. Corrija nomes comuns: pinche/pincher=pinscher, shitzu=Shih Tzu, bernesse=Bernese Mountain Dog.",
    "Se houver frase com grupos mistos, preserve todos. Ex.: 4 gatos e 2 cachorros = dois itens no array pets.",
    "JSON com chaves: modalidade, origem, destino, pets, taxaGoiadex, taxaPetrolina, rotaNordesteSudeste, pedagioEstimado, inconsistencia, msgInconsistencia, nomeCliente, telefoneCliente, tipoCliente, dataViagem.",
    "Texto do cliente:", texto
  ].join("\n");

  const resp = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + apiKey },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }]
    })
  });

  const code = resp.getResponseCode();
  const body = resp.getContentText();
  if (code < 200 || code >= 300) throw new Error("Erro OpenAI " + code + ": " + body);

  const json = JSON.parse(body);
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!content) throw new Error("OpenAI nÃ£o retornou conteÃºdo.");
  return JSON.parse(String(content).replace(/```json|```/g, "").trim());
}

function BP_normalizarDados_(texto, ia, modalidadeForcada) {
  const inconsistencias = [];
  const modalidadeIA = BP_norm_(ia.modalidade || "compartilhado");
  const modalidade = ["compartilhado", "exclusivo", "duplo"].indexOf(modalidadeForcada) >= 0 ? modalidadeForcada : (["compartilhado", "exclusivo", "duplo"].indexOf(modalidadeIA) >= 0 ? modalidadeIA : "compartilhado");

  let pets = BP_normalizarPets_(ia.pets || [], texto);
  const petsLocal = BP_extrairPetsLocal_(texto);
  if (petsLocal.length && BP_totalPets_(petsLocal) > BP_totalPets_(pets)) pets = petsLocal;
  if (!pets.length) {
    pets = [{ quantidade: 1, especie: "cao", raca: "CÃ£o", idade: "", pesoKg: "", porte: "M", filhote: false, tipoCalculo: "adulto_cao" }];
    inconsistencias.push("NÃ£o consegui identificar os pets com seguranÃ§a; usei 1 cÃ£o mÃ©dio como fallback.");
  }

  const origem = BP_limparCidade_(ia.origem || BP_extrairOrigemLocal_(texto));
  const destino = BP_limparCidade_(ia.destino || BP_extrairDestinoLocal_(texto));
  if (!origem) inconsistencias.push("Origem nÃ£o identificada.");
  if (!destino) inconsistencias.push("Destino nÃ£o identificado.");

  if (ia.inconsistencia && ia.msgInconsistencia) inconsistencias.push(String(ia.msgInconsistencia));

  return {
    modalidade: modalidade,
    origem: origem,
    destino: destino,
    pets: pets,
    qtdPets: BP_totalPets_(pets),
    temCao: pets.some(p => p.especie === "cao"),
    temGato: pets.some(p => p.especie === "gato"),
    taxaGoiadex: !!ia.taxaGoiadex,
    taxaPetrolina: !!ia.taxaPetrolina,
    rotaNordesteSudeste: !!ia.rotaNordesteSudeste || BP_detectarRotaNordesteSudeste_(origem, destino),
    nomeCliente: ia.nomeCliente || BP_extrairNome_(texto),
    telefoneCliente: ia.telefoneCliente || BP_extrairTelefone_(texto),
    tipoCliente: ia.tipoCliente || BP_extrairTipoCliente_(texto),
    dataViagem: ia.dataViagem || BP_extrairData_(texto),
    inconsistencias: inconsistencias
  };
}

function BP_normalizarPets_(pets, texto) {
  if (!Array.isArray(pets)) return [];
  return pets.map(p => {
    const quantidade = BP_qtd_(p.quantidade || p.qtd || 1);
    const especie = BP_norm_(p.especie).indexOf("gato") >= 0 ? "gato" : "cao";
    const raca = BP_racaNormalizada_(p.raca || p.racaNormalizada || p.descricao || (especie === "gato" ? "Gato" : "CÃ£o"), especie);
    const pesoKg = BP_num_(p.pesoKg || p.peso || "");
    const filhote = !!p.filhote || BP_norm_([p.idade, p.descricao, raca].join(" ")).match(/filhote|\b[1-5]\s*mes|\b\d{1,2}\s*dias/);
    const porte = especie === "gato" ? "M" : BP_portePet_(p.porte, raca, pesoKg, texto);
    const tipoCalculo = especie === "gato" ? "gato" : (filhote ? "filhote_cao" : "adulto_cao");
    return { quantidade, especie, raca, idade: p.idade || "", pesoKg: pesoKg || "", porte, filhote: !!filhote, tipoCalculo };
  }).filter(p => p.quantidade >= 1 && p.quantidade <= 20);
}

function BP_extrairPetsLocal_(texto) {
  const t = BP_textoSemTelefones_(texto);
  const grupos = [];
  const re = /(\d{1,2})\s+([^.!?\n]{0,70}?)(gatos?|gatas?|cachorros?|cachorras?|cÃ£es|caes|cÃ£o|cao|vira\s*latas?|vira-latas?|srd|husky|huskies|pinscher|pincher|pinche|bull\s*terrier|pitbull|bully|poodle|spitz|shih\s*tzu|shitzu|bernese|bernesse|pastor|golden|labrador|chow\s*chow)/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    const qtd = BP_qtd_(m[1]);
    const trecho = String((m[2] || "") + " " + (m[3] || "")).trim();
    if (!qtd) continue;
    const nt = BP_norm_(trecho);
    const especie = /gato|gata/.test(nt) ? "gato" : "cao";
    const peso = BP_num_((String(t).slice(m.index, m.index + 120).match(/(\d{1,2})(?:\s*,\s*\d)?\s*kg/i) || [])[1]);
    const filhote = /filhote|\b[1-5]\s*mes|\b\d{1,2}\s*dias/.test(nt);
    const raca = BP_racaNormalizada_(trecho, especie);
    const porte = especie === "gato" ? "M" : BP_portePet_("", raca, peso, trecho);
    grupos.push({ quantidade: qtd, especie, raca, idade: "", pesoKg: peso || "", porte, filhote, tipoCalculo: especie === "gato" ? "gato" : (filhote ? "filhote_cao" : "adulto_cao") });
  }
  return BP_unificarPets_(grupos);
}

function BP_unificarPets_(pets) {
  const out = [];
  pets.forEach(p => {
    const key = [p.especie, p.raca, p.porte, p.tipoCalculo, p.pesoKg || ""].join("|");
    const ex = out.find(x => [x.especie, x.raca, x.porte, x.tipoCalculo, x.pesoKg || ""].join("|") === key);
    if (ex) ex.quantidade += p.quantidade;
    else out.push(p);
  });
  return out;
}

function BP_calcularCompartilhado_(dados, rota) {
  const linhas = [];
  let total = 0;
  dados.pets.forEach(p => {
    let taxa = 0.50;
    if (p.tipoCalculo === "adulto_cao") taxa = dados.rotaNordesteSudeste ? 0.70 : 0.90;
    let unit = rota.principal.km * taxa;
    if (p.tipoCalculo === "adulto_cao") {
      if (p.porte === "PP") unit *= 0.80;
      if (p.porte === "P") unit *= 0.90;
      if (p.porte === "G") unit *= 1.10;
      if (p.porte === "GG") unit *= 1.20;
    }
    if (unit < BP_CALC.MIN_COMPARTILHADO) unit = BP_CALC.MIN_COMPARTILHADO;
    if (["gato", "filhote_cao"].indexOf(p.tipoCalculo) >= 0 && unit > BP_CALC.TETO_GATO_FILHOTE) unit = BP_CALC.TETO_GATO_FILHOTE;
    if (p.tipoCalculo === "adulto_cao" && unit > BP_CALC.TETO_CAO_ADULTO) unit = BP_CALC.TETO_CAO_ADULTO;
    if (dados.taxaGoiadex) unit += BP_CALC.ADICIONAL_GO_DF_INTERIOR;
    if (dados.taxaPetrolina) unit += BP_CALC.ADICIONAL_PETROLINA;
    unit = Math.round(unit);
    total += unit * p.quantidade;
    linhas.push({ descricao: BP_descPet_(p), quantidade: p.quantidade, valorUnitario: unit, total: unit * p.quantidade });
  });
  return { linhas, total, km: rota.principal.km };
}

function BP_calcularExclusivo_(dados, rota, pedagio) {
  const kmExclusivo = rota.exclusivo.total || 0;
  const valorKm = Math.round(kmExclusivo * BP_CALC.VALOR_KM_EXCLUSIVO);
  const adicionalPets = dados.qtdPets * BP_CALC.ADICIONAL_POR_PET_EXCLUSIVO;
  const total = Math.round(valorKm + adicionalPets + (Number(pedagio) || 0));
  return { kmExclusivo, valorKm, adicionalPets, pedagio: Number(pedagio) || 0, total };
}

function BP_calcularRotas_(origem, destino) {
  const principal = BP_calcularKmTrechoSeguro_(origem, destino);
  const t1 = BP_calcularKmTrechoSeguro_(BP_CALC.BASE_EXCLUSIVO, origem);
  const t2 = principal;
  const t3 = BP_calcularKmTrechoSeguro_(destino, BP_CALC.BASE_EXCLUSIVO);
  const total = (t1.km || 0) + (t2.km || 0) + (t3.km || 0);
  return { principal, exclusivo: { total, trecho1: t1, trecho2: t2, trecho3: t3, ok: total > 0 && t1.km > 0 && t2.km > 0 && t3.km > 0 } };
}

function BP_calcularKmTrechoSeguro_(origem, destino) {
  origem = BP_limparCidade_(origem); destino = BP_limparCidade_(destino);
  const manual = BP_kmManual_(origem, destino);
  if (manual) return { km: manual, fonte: "manual", origem, destino };
  const api = BP_kmOSRM_(origem, destino);
  if (api > 0) return { km: Math.round(api), fonte: "OSRM/API", origem, destino };
  return { km: 0, fonte: "erro", origem, destino };
}

const BP_ROTAS_MANUAIS_KM = {
  "SAO BERNARDO DO CAMPO SP|SAO PAULO SP": 25,
  "SAO PAULO SP|SAO BERNARDO DO CAMPO SP": 25,
  "SAO PAULO SP|PARAPUA SP": 602,
  "PARAPUA SP|SAO PAULO SP": 602,
  "PARAPUA SP|SAO BERNARDO DO CAMPO SP": 625,
  "SAO BERNARDO DO CAMPO SP|PARAPUA SP": 625
};

function BP_kmManual_(origem, destino) {
  return BP_ROTAS_MANUAIS_KM[BP_chaveCidade_(origem) + "|" + BP_chaveCidade_(destino)] || null;
}

function BP_kmOSRM_(origem, destino) {
  try {
    const co = BP_coord_(origem); const cd = BP_coord_(destino);
    if (!co || !cd) return 0;
    const url = "https://router.project-osrm.org/route/v1/driving/" + co.lon + "," + co.lat + ";" + cd.lon + "," + cd.lat + "?overview=false";
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const json = JSON.parse(resp.getContentText());
    return json.code === "Ok" && json.routes && json.routes[0] ? json.routes[0].distance / 1000 : 0;
  } catch(e) { return 0; }
}

function BP_coord_(cidade) {
  try {
    cidade = BP_limparCidade_(cidade);
    const cidadeVirgula = cidade.replace(/\s+(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/i, ", $1");
    const q = encodeURIComponent(cidadeVirgula + ", Brasil");
    const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&addressdetails=1&q=" + q;
    const resp = UrlFetchApp.fetch(url, { headers: { "User-Agent": "BeloPet/1.0", "Accept-Language": "pt-BR" }, muteHttpExceptions: true });
    const arr = JSON.parse(resp.getContentText());
    return arr && arr[0] ? { lat: arr[0].lat, lon: arr[0].lon, display_name: arr[0].display_name } : null;
  } catch(e) { return null; }
}

function BP_montarMensagem_(dados, comp, excl, rota) {
  const origem = BP_formatarCidade_(dados.origem);
  const destino = BP_formatarCidade_(dados.destino);
  const qtdTxt = dados.qtdPets === 1 ? "1 pet" : dados.qtdPets + " pets";
  const icone = dados.temCao && dados.temGato ? "ðŸ¾" : (dados.temGato ? "ðŸ±" : "ðŸ¶");
  const petsDesc = dados.pets.map(p => (p.quantidade > 1 ? p.quantidade + "x " : "") + BP_descPet_(p)).join(" + ");
  const prazoComp = BP_prazo_(rota.principal.km);
  const prazoExcl = BP_prazo_(rota.principal.km);
  const intro = "Vamos lÃ¡! ðŸ˜Š Vou te explicar direitinho como funciona o transporte para o seu pet:\n\n" + icone + " Pets: " + petsDesc + "\n\n";

  const cuidados = "ðŸ“ LocalizaÃ§Ã£o em tempo real\nâ±ï¸ Paradas para cuidados a cada 4 horas\nðŸ’§ Ãgua disponÃ­vel durante toda a viagem\nðŸ§¼ Tapetes higiÃªnicos e higienizaÃ§Ã£o constante\nâ„ï¸ Van com ar-condicionado ligado o tempo todo\n\n";
  const docs = "ðŸ“‹ Para viajar, Ã© necessÃ¡rio:\n\nCarteirinha de vacinaÃ§Ã£o atualizada\nAtestado veterinÃ¡rio\nEnvie raÃ§Ã£o suficiente para todos os dias de viagem\nAs vacinas obrigatÃ³rias devem estar dentro do prazo de validade e registradas na carteirinha (a vacinaÃ§Ã£o Ã© anual)\n\n";
  const rodape = "ðŸ“² Veja como funciona nosso transporte:\nInstagram: https://www.instagram.com/p/DV6SKPKDKqm/?igsh=MW9zajNvNmJ5Znc0\nSite: www.belopet.com.br\n\nðŸ“¸ Instagram: @aletaxipet\n\nâœ¨ Desde 2013\nðŸŽ–ï¸ Ã“timas avaliaÃ§Ãµes\n\nDesde 2013 transportando pets com carinho, conforto e seguranÃ§a! ðŸ¶ðŸ±ðŸš";

  const linhasComp = comp.linhas.map(l => "ðŸ’° " + l.descricao + ": *" + BP_moeda_(l.valorUnitario) + (l.quantidade > 1 ? " cada" : "") + "*").join("\n");
  const txtComp = "ðŸ”¹ OPÃ‡ÃƒO â€” COMPARTILHADO ðŸ”¹\n\nðŸš Transporte Pet â€“ " + origem + " atÃ© " + destino + "\n\n" + linhasComp + "\nðŸ’° Valor total (" + qtdTxt + "): *" + BP_moeda_(comp.total) + "*\nðŸ•’ Tempo aproximado de transporte: " + prazoComp + "\n\nðŸ¾ Transporte compartilhado com outros pets, cada um acomodado em caixa de transporte individual fornecida por nÃ³s e higienizada antes de cada viagem.\n\nðŸ“ Trabalhamos com pontos de encontro para retirada e entrega, mas tambÃ©m oferecemos serviÃ§o porta a porta com taxa adicional.\n\n" + cuidados + docs + rodape;
  const txtExcl = "ðŸ”¹ OPÃ‡ÃƒO â€” EXCLUSIVO ðŸ”¹\n\nðŸš Transporte Pet â€“ " + origem + " atÃ© " + destino + "\n\nðŸ’° Valor total (" + qtdTxt + "): *" + BP_moeda_(excl.total) + "*\nðŸ•’ Tempo aproximado de transporte: " + prazoExcl + "\n\nðŸ¾ Transporte exclusivo. Apenas o(s) seu(s) pet(s) acompanha(m) o transporte.\nðŸ¾ Os pets viajam em caixas de transporte individuais fornecidas pela BeloPet e higienizadas antes de cada viagem.\nðŸ“ Retirada e entrega porta a porta\n\n" + cuidados + docs + rodape;

  if (dados.modalidade === "compartilhado") return intro + txtComp;
  if (dados.modalidade === "exclusivo") return intro + txtExcl;
  return intro + "ðŸš Transporte Pet â€“ " + origem + " atÃ© " + destino + "\n\nPara seu caso, temos 2 opÃ§Ãµes de transporte:\n\n" + txtComp + "\n\n" + txtExcl;
}

function BP_montarDiagnostico_(dados, rota, comp, excl) {
  const caes = dados.pets.filter(p => p.especie === "cao").reduce((s,p)=>s+p.quantidade,0);
  const gatos = dados.pets.filter(p => p.especie === "gato").reduce((s,p)=>s+p.quantidade,0);
  const linhas = [];
  linhas.push("ðŸ“‹ Dados interpretados", "");
  linhas.push("Modalidade: " + dados.modalidade);
  linhas.push("Origem: " + dados.origem);
  linhas.push("Destino: " + dados.destino, "");
  linhas.push("Pets identificados: " + dados.qtdPets);
  linhas.push("ðŸ¶ CÃ£es: " + caes);
  linhas.push("ðŸ± Gatos: " + gatos, "");
  linhas.push("Detalhes:");
  dados.pets.forEach(p => linhas.push("â€¢ " + p.quantidade + " " + BP_descPet_(p)));
  linhas.push("", "KM origem â†’ destino: " + Math.round(rota.principal.km || 0) + " km [" + rota.principal.fonte + "]");
  linhas.push("KM exclusivo total: " + Math.round(rota.exclusivo.total || 0) + " km");
  linhas.push("Compartilhado total: " + BP_moeda_(comp.total));
  linhas.push("Exclusivo total: " + BP_moeda_(excl.total));
  if (dados.inconsistencias.length) linhas.push("", "âš ï¸ " + dados.inconsistencias.join("\nâš ï¸ "));
  return linhas.join("\n");
}

function BP_montarPayloadCRM_(payload, dados, comp, excl, msg) {
  return {
    acao: "orcamento_crm",
    dataOrcamento: BP_dataHojeBR_(),
    nome: payload.nomeCliente || dados.nomeCliente || "",
    telefone: BP_limparTelefone_(payload.telefoneCliente || dados.telefoneCliente || ""),
    tipoCliente: payload.tipoCliente || dados.tipoCliente || "Outro",
    origem: BP_formatarCidade_(dados.origem),
    destino: BP_formatarCidade_(dados.destino),
    modalidade: dados.modalidade,
    pet: dados.pets.map(p => (p.quantidade > 1 ? p.quantidade + "x " : "") + BP_descPet_(p)).join(" + "),
    qtdPets: dados.qtdPets,
    km: Math.round(dados.km || 0),
    valorCompartilhado: comp.total,
    valorExclusivo: excl.total,
    status: "Aguardando",
    ultimoContato: BP_dataHojeBR_(),
    proximoFollowUp: BP_somarDiasBR_(3),
    origemLead: payload.origemLead || "",
    dataViagem: payload.dataViagem || dados.dataViagem || "",
    mensagemWhatsApp: msg
  };
}

function BP_salvarCRM_(payload) {
  try {
    UrlFetchApp.fetch(BP_CALC.CRM_WEBAPP_URL, { method: "post", contentType: "text/plain;charset=utf-8", payload: JSON.stringify(payload), muteHttpExceptions: true });
  } catch(e) {}
}

/* Helpers */
function BP_norm_(s){ return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim(); }
function BP_qtd_(n){ n=parseInt(n,10); return isFinite(n)&&n>=1&&n<=20?n:0; }
function BP_num_(v){ const n=Number(String(v||"").replace(",",".").replace(/[^\d.]/g,"")); return isFinite(n)&&n>0?n:0; }
function BP_totalPets_(pets){ return (pets||[]).reduce((s,p)=>s+(parseInt(p.quantidade,10)||1),0); }
function BP_textoSemTelefones_(t){ return String(t||"").replace(/\+?55\s*/g," ").replace(/\(?\b\d{2}\)?[\s.\-]*9?\d{4}[\s.\-]*\d{4}\b/g," ").replace(/\b\d{6,}\b/g," "); }
function BP_limparTelefone_(v){ return String(v||"").replace(/\D/g,""); }
function BP_limparCidade_(v){ return String(v||"").replace(/["']/g,"").replace(/\s*\/\s*/g," ").replace(/\s*-\s*/g," ").replace(/\s+/g," ").trim(); }
function BP_chaveCidade_(cidade){ return BP_limparCidade_(cidade).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/\b(BRASIL|BR|CEP|CAPITAL|CIDADE|MUNICIPIO)\b/g,"").replace(/\s+/g," ").trim(); }
function BP_moeda_(v){ return Math.round(Number(v)||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"}); }
function BP_formatarCidade_(v){ return String(v||"").trim().toLowerCase().replace(/(^|\s)(\S)/g,(_,a,b)=>a+b.toUpperCase()).replace(/\b(Sp|Rj|Mg|Es|Pr|Sc|Rs|Ba|Se|Al|Pe|Pb|Rn|Ce|Go|Df)\b/g, m=>m.toUpperCase()); }
function BP_dataHojeBR_(){ const d=new Date(); return String(d.getDate()).padStart(2,"0")+"/"+String(d.getMonth()+1).padStart(2,"0")+"/"+d.getFullYear(); }
function BP_somarDiasBR_(dias){ const d=new Date(); d.setDate(d.getDate()+dias); return String(d.getDate()).padStart(2,"0")+"/"+String(d.getMonth()+1).padStart(2,"0")+"/"+d.getFullYear(); }
function BP_prazo_(km){ km=Number(km)||0; if(km<=350)return "atÃ© 24 horas"; if(km<=700)return "1 dia"; const b=Math.max(1,Math.ceil(km/1200)); return b+" a "+(b+1)+" dias"; }
function BP_descPet_(p){ const partes=[p.raca || (p.especie==="gato"?"Gato":"CÃ£o")]; if(p.idade)partes.push(p.idade); if(p.pesoKg)partes.push("aprox. "+p.pesoKg+" kg"); if(p.especie==="cao"&&p.porte)partes.push({PP:"porte PP",P:"porte pequeno",M:"porte mÃ©dio",G:"porte grande",GG:"porte GG"}[p.porte]||"porte mÃ©dio"); return partes.join(" â€¢ "); }
function BP_racaNormalizada_(raca, especie){ const t=BP_norm_(raca); if(especie==="gato") return /srd|vira lata|viralata|sem raca/.test(t)?"Gato SRD":"Gato"; if(/srd|vira lata|viralata|sem raca/.test(t))return "CÃ£o SRD"; if(/pincher|pinche|pinscher/.test(t))return "Pinscher"; if(/shitzu|shih/.test(t))return "Shih Tzu"; if(/bernese|bernesse/.test(t))return "Bernese Mountain Dog"; if(/bull terrier/.test(t))return "Bull Terrier"; if(/husky|huskies/.test(t))return "Husky Siberiano"; if(/chow/.test(t))return "Chow Chow"; if(/poodle/.test(t))return "Poodle"; if(/golden/.test(t))return "Golden Retriever"; if(/labrador/.test(t))return "Labrador"; if(/pastor/.test(t))return "Pastor AlemÃ£o"; if(/bully|pit/.test(t))return "American Bully/Pit Bull"; return raca || "CÃ£o"; }
function BP_portePet_(porte, raca, peso, texto){ const p=String(porte||"").toUpperCase(); if(["PP","P","M","G","GG"].indexOf(p)>=0)return p; peso=Number(peso)||0; if(peso>0){ if(peso<=6)return "P"; if(peso<=18)return "M"; if(peso<=35)return "G"; return "GG"; } const t=BP_norm_([raca,texto].join(" ")); if(/pp|toy|mini/.test(t))return "PP"; if(/pequeno|pinscher|shih|spitz|poodle/.test(t))return "P"; if(/grande|husky|golden|labrador|pastor|chow|bernese|bully|pit/.test(t))return "G"; return "M"; }
function BP_detectarRotaNordesteSudeste_(origem,destino){ const ne=["BA","SE","AL","PE","PB","RN","CE","PI","MA"]; const ss=["SP","RJ","MG","ES","PR","SC","RS"]; origem=String(origem||"").toUpperCase(); destino=String(destino||"").toUpperCase(); return ne.some(uf=>origem.endsWith(" "+uf)||origem.includes("/"+uf)) && ss.some(uf=>destino.endsWith(" "+uf)||destino.includes("/"+uf)); }
function BP_extrairTelefone_(t){ const m=String(t||"").match(/(?:\+?55\s*)?(\d{2})[\s().-]*(9?\d{4})[\s.-]*(\d{4})/); return m?m[1]+m[2]+m[3]:""; }
function BP_extrairNome_(t){ return ""; }
function BP_extrairTipoCliente_(t){ t=BP_norm_(t); if(/mudanca/.test(t))return "MudanÃ§a"; if(/filhote|canil|criador/.test(t))return "Filhote"; return "Outro"; }
function BP_extrairData_(t){ const m=String(t||"").match(/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/); return m?m[0].replace(/-/g,"/"):""; }
function BP_extrairOrigemLocal_(t){ return ""; }
function BP_extrairDestinoLocal_(t){ return ""; }
