/***************
 * CalculadoraMotor_CORRIGIDO.gs â€” BeloPet
 * Substitua o conteÃºdo atual de CalculadoraMotor.gs por este arquivo.
 * MantÃ©m a tela atual em HTMLService e centraliza: IA, parser, KM, compartilhado, exclusivo, duplo, CRM e mensagem.
 ***************/

var BP2_CALC = {
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

function doGetCalculadoraDesativado(e) {
  return HtmlService.createHtmlOutputFromFile("calcb")
    .setTitle("BeloPet â€” Calculadora")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function BP_calcularOrcamento(payload) {
  try {
    payload = payload || {};
    var texto = String(payload.texto || "").trim();
    var modalidadeForcada = BP2_norm(payload.modalidade || "");
    var apiKey = String(payload.openaiKey || PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY") || "").trim();

    if (!texto) throw new Error("Texto do cliente vazio.");
    if (!apiKey) throw new Error("Chave OpenAI ausente. Configure no campo da tela ou em Script Properties como OPENAI_API_KEY.");

    var ia = BP2_interpretarComOpenAI(texto, apiKey);
    var dados = BP2_normalizarDados(texto, ia, modalidadeForcada, payload);

    var rota = BP2_calcularRotas(dados.origem, dados.destino, dados.kmInformadoTexto);
    dados.km = rota.principal.km;

    if (!rota.principal.km || rota.principal.km <= 0) {
      dados.inconsistencias.push("NÃ£o foi possÃ­vel calcular a distÃ¢ncia origem â†’ destino.");
    }

    if ((dados.modalidade === "exclusivo" || dados.modalidade === "duplo") && !rota.exclusivo.ok) {
      dados.inconsistencias.push("KM exclusivo incompleto/suspeito. Confira os trechos antes de enviar.");
    }

    var compartilhado = BP2_calcularCompartilhado(dados, rota);
    var exclusivo = BP2_calcularExclusivo(dados, rota, Number(payload.pedagio || ia.pedagioEstimado || 0));
    var mensagemWhatsApp = BP2_montarMensagem(dados, compartilhado, exclusivo, rota);
    var diagnostico = BP2_montarDiagnostico(dados, rota, compartilhado, exclusivo);

    var crm = BP2_montarPayloadCRM(payload, dados, compartilhado, exclusivo, mensagemWhatsApp);
    if (payload.salvarCRM !== false) BP2_salvarCRM(crm);

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

function BP2_interpretarComOpenAI(texto, apiKey) {
  var prompt = [
    "VocÃª Ã© o interpretador oficial do sistema BeloPet.",
    "Responda EXCLUSIVAMENTE com JSON vÃ¡lido, sem markdown.",
    "Extraia SOMENTE dados presentes no texto. NÃ£o invente idade, raÃ§a, telefone, data ou valor.",
    "modalidade: compartilhado, exclusivo ou duplo. Se nÃ£o constar, use compartilhado.",
    "origem e destino: cidade + UF quando houver. Nunca use bairro como cidade se a cidade estiver clara. Se o cliente disser bairro + cidade, retorne a cidade e UF.",
    "pets: OBRIGATÃ“RIO devolver array pets, com um item por grupo de animais. Preserve todos os grupos mistos.",
    "Cada item de pets deve ter: quantidade, especie ('cao' ou 'gato'), raca, idade, pesoKg, porte (PP/P/M/G/GG), filhote (true/false).",
    "Todo gato Ã© especie gato, porte M para cÃ¡lculo, mesmo adulto.",
    "CÃ£o SRD/vira-lata sem porte explÃ­cito: use M, mas se houver peso, estime: atÃ© 6kg P, 7-18kg M, 19-35kg G, acima GG.",
    "RaÃ§as caninas mesmo com grafia errada devem ser especie cao. Corrija nomes comuns: pinche/pincher=pinscher, shitzu=Shih Tzu, bernesse=Bernese Mountain Dog.",
    "Exemplo de regra: 4 gatos e 2 cachorros = dois itens no array pets, total 6.",
    "JSON com chaves: modalidade, origem, destino, pets, taxaGoiadex, taxaPetrolina, rotaNordesteSudeste, pedagioEstimado, inconsistencia, msgInconsistencia, nomeCliente, telefoneCliente, tipoCliente, dataViagem.",
    "Texto do cliente:", texto
  ].join("\n");

  var resp = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", {
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

  var code = resp.getResponseCode();
  var body = resp.getContentText();
  if (code < 200 || code >= 300) throw new Error("Erro OpenAI " + code + ": " + body);

  var json = JSON.parse(body);
  var content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!content) throw new Error("OpenAI nÃ£o retornou conteÃºdo.");
  return JSON.parse(String(content).replace(/```json|```/g, "").trim());
}

function BP2_normalizarDados(texto, ia, modalidadeForcada, payload) {
  ia = ia || {};
  payload = payload || {};
  var inconsistencias = [];
  var modalidadeIA = BP2_norm(ia.modalidade || "compartilhado");
  var modalidade = ["compartilhado", "exclusivo", "duplo"].indexOf(modalidadeForcada) >= 0
    ? modalidadeForcada
    : (["compartilhado", "exclusivo", "duplo"].indexOf(modalidadeIA) >= 0 ? modalidadeIA : "compartilhado");

  var petsIA = BP2_normalizarPets(ia.pets || [], texto);
  var petsLocal = BP2_extrairPetsLocal(texto);
  var pets = petsIA;

  // PreferÃªncia local quando encontra mais pets/grupos. Corrige casos 4 gatos + 2 cÃ£es, Bull Terrier + gato etc.
  if (petsLocal.length && (BP2_totalPets(petsLocal) > BP2_totalPets(petsIA) || petsLocal.length > petsIA.length)) {
    pets = petsLocal;
  }

  if (!pets.length) {
    pets = [{ quantidade: 1, especie: "cao", raca: "CÃ£o", idade: "", pesoKg: "", porte: "M", filhote: false, tipoCalculo: "adulto_cao" }];
    inconsistencias.push("NÃ£o consegui identificar os pets com seguranÃ§a; usei 1 cÃ£o mÃ©dio como fallback.");
  }

  pets = BP2_unificarPets(pets);

  var origem = BP2_limparCidade(ia.origem || BP2_extrairOrigemLocal(texto));
  var destino = BP2_limparCidade(ia.destino || BP2_extrairDestinoLocal(texto));

  if (!origem) inconsistencias.push("Origem nÃ£o identificada.");
  if (!destino) inconsistencias.push("Destino nÃ£o identificado.");
  if (ia.inconsistencia && ia.msgInconsistencia) inconsistencias.push(String(ia.msgInconsistencia));

  var taxaGoiadex = !!ia.taxaGoiadex || !!payload.taxaGoiadexManual;
  var taxaPetrolina = !!ia.taxaPetrolina || !!payload.taxaPetrolinaManual;
  var kmInformadoTexto = BP2_extrairKmInformado(texto);

  return {
    modalidade: modalidade,
    origem: origem,
    destino: destino,
    pets: pets,
    qtdPets: BP2_totalPets(pets),
    temCao: pets.some(function(p){ return p.especie === "cao"; }),
    temGato: pets.some(function(p){ return p.especie === "gato"; }),
    taxaGoiadex: taxaGoiadex,
    taxaPetrolina: taxaPetrolina,
    rotaNordesteSudeste: !!ia.rotaNordesteSudeste || BP2_detectarRotaNordesteSudeste(origem, destino),
    nomeCliente: ia.nomeCliente || BP2_extrairNome(texto),
    telefoneCliente: ia.telefoneCliente || BP2_extrairTelefone(texto),
    tipoCliente: ia.tipoCliente || BP2_extrairTipoCliente(texto),
    dataViagem: ia.dataViagem || BP2_extrairData(texto),
    kmInformadoTexto: kmInformadoTexto,
    inconsistencias: inconsistencias
  };
}

function BP2_normalizarPets(pets, texto) {
  if (!Array.isArray(pets)) return [];
  var out = [];
  pets.forEach(function(p) {
    var quantidade = BP2_qtd(p.quantidade || p.qtd || 1);
    if (!quantidade) quantidade = 1;
    var especie = BP2_norm(p.especie).indexOf("gato") >= 0 ? "gato" : "cao";
    var raca = BP2_racaNormalizada(p.raca || p.racaNormalizada || p.descricao || (especie === "gato" ? "Gato" : "CÃ£o"), especie);
    var idade = String(p.idade || "").trim();
    var pesoKg = BP2_num(p.pesoKg || p.peso || "");
    var filhote = !!p.filhote || /filhote|\b[1-5]\s*mes|\b\d{1,2}\s*dias/.test(BP2_norm([idade, p.descricao, raca].join(" ")));
    var porte = especie === "gato" ? "M" : BP2_portePet(p.porte, raca, pesoKg, [texto, idade].join(" "));
    var tipoCalculo = especie === "gato" ? "gato" : (filhote ? "filhote_cao" : "adulto_cao");
    out.push({ quantidade: quantidade, especie: especie, raca: raca, idade: idade, pesoKg: pesoKg || "", porte: porte, filhote: !!filhote, tipoCalculo: tipoCalculo });
  });
  return out.filter(function(p){ return p.quantidade >= 1 && p.quantidade <= 20; });
}

function BP2_extrairPetsLocal(texto) {
  var tOriginal = BP2_textoSemTelefones(texto);
  var t = String(tOriginal || "").replace(/[\n\r]+/g, " . ");
  var grupos = [];

  // Captura grupos numÃ©ricos como: 4 gatos, aproximadamente 5 kg / 2 cachorros vira-lata de 13 kg.
  var re = /(\d{1,2})\s+([^.!?;\n]{0,90}?)(gatos?|gatas?|cachorros?|cachorras?|cÃ£es|caes|cÃ£o|cao|vira\s*latas?|vira-latas?|srd|husky|huskies|pinscher|pincher|pinche|bull\s*terrier|pitbull|bully|poodle|spitz|shih\s*tzu|shitzu|bernese|bernesse|pastor|golden|labrador|chow\s*chow)([^.!?;\n]{0,80})/gi;
  var m;
  while ((m = re.exec(t)) !== null) {
    var qtd = BP2_qtd(m[1]);
    if (!qtd) continue;
    var trecho = String((m[2] || "") + " " + (m[3] || "") + " " + (m[4] || "")).trim();
    var nt = BP2_norm(trecho);
    var especie = /gato|gata/.test(nt) ? "gato" : "cao";
    var peso = BP2_num((trecho.match(/(\d{1,2})(?:\s*,\s*\d)?\s*kg/i) || [])[1]);
    var idade = (trecho.match(/\b(\d{1,2}\s*(?:anos?|mes(?:es)?|dias?))\b/i) || [])[1] || "";
    var filhote = /filhote|\b[1-5]\s*mes|\b\d{1,2}\s*dias/.test(nt);
    var raca = BP2_racaNormalizada(trecho, especie);
    var porte = especie === "gato" ? "M" : BP2_portePet("", raca, peso, trecho);
    grupos.push({ quantidade: qtd, especie: especie, raca: raca, idade: idade, pesoKg: peso || "", porte: porte, filhote: filhote, tipoCalculo: especie === "gato" ? "gato" : (filhote ? "filhote_cao" : "adulto_cao") });
  }

  // Por extenso: um Bull Terrier e um gato; dois gatos; duas cachorras.
  var regras = [
    { re: /\bum\s+(bull\s*terrier|gato|cachorro|cao|cÃ£o|husky|bernese|bernesse|srd|pitbull|american\s*bully|bully|chow\s*chow|golden|labrador|pastor|pinscher|pincher|pinche|poodle|spitz)\b/gi, qtd: 1 },
    { re: /\buma\s+(gata|cachorra|vira\s*lata|srd)\b/gi, qtd: 1 },
    { re: /\bdois\s+(gatos|cachorros|caes|cÃ£es|huskies)\b/gi, qtd: 2 },
    { re: /\bduas\s+(gatas|cachorras)\b/gi, qtd: 2 },
    { re: /\b(tres|trÃªs)\s+(gatos|gatas|cachorros|cachorras|caes|cÃ£es)\b/gi, qtd: 3 }
  ];
  regras.forEach(function(regra) {
    var mm;
    while ((mm = regra.re.exec(t)) !== null) {
      var trecho = mm[1] || mm[2] || "";
      var nt = BP2_norm(trecho);
      var especie = /gato|gata/.test(nt) ? "gato" : "cao";
      var raca = BP2_racaNormalizada(trecho, especie);
      var filhote = /filhote|\b[1-5]\s*mes|\b\d{1,2}\s*dias/.test(BP2_norm(t));
      grupos.push({ quantidade: regra.qtd, especie: especie, raca: raca, idade: "", pesoKg: "", porte: especie === "gato" ? "M" : BP2_portePet("", raca, 0, trecho), filhote: filhote, tipoCalculo: especie === "gato" ? "gato" : (filhote ? "filhote_cao" : "adulto_cao") });
    }
  });

  return BP2_unificarPets(grupos);
}

function BP2_unificarPets(pets) {
  var out = [];
  (pets || []).forEach(function(p) {
    var key = [p.especie, p.raca, p.porte, p.tipoCalculo, p.pesoKg || "", p.idade || ""].join("|");
    var ex = out.find(function(x){ return [x.especie, x.raca, x.porte, x.tipoCalculo, x.pesoKg || "", x.idade || ""].join("|") === key; });
    if (ex) ex.quantidade += p.quantidade;
    else out.push(p);
  });
  return out;
}

function BP2_calcularCompartilhado(dados, rota) {
  var linhas = [];
  var total = 0;
  dados.pets.forEach(function(p) {
    var taxa = 0.50;
    if (p.tipoCalculo === "adulto_cao") taxa = dados.rotaNordesteSudeste ? 0.70 : 0.90;
    var unit = rota.principal.km * taxa;

    if (p.tipoCalculo === "adulto_cao") {
      if (p.porte === "PP") unit *= 0.80;
      if (p.porte === "P") unit *= 0.90;
      if (p.porte === "G") unit *= 1.10;
      if (p.porte === "GG") unit *= 1.20;
    }

    if (unit < BP2_CALC.MIN_COMPARTILHADO) unit = BP2_CALC.MIN_COMPARTILHADO;
    if (["gato", "filhote_cao"].indexOf(p.tipoCalculo) >= 0 && unit > BP2_CALC.TETO_GATO_FILHOTE) unit = BP2_CALC.TETO_GATO_FILHOTE;
    if (p.tipoCalculo === "adulto_cao" && unit > BP2_CALC.TETO_CAO_ADULTO) unit = BP2_CALC.TETO_CAO_ADULTO;
    if (dados.taxaGoiadex) unit += BP2_CALC.ADICIONAL_GO_DF_INTERIOR;
    if (dados.taxaPetrolina) unit += BP2_CALC.ADICIONAL_PETROLINA;

    unit = Math.round(unit);
    total += unit * p.quantidade;
    linhas.push({ descricao: BP2_descPet(p), quantidade: p.quantidade, valorUnitario: unit, total: unit * p.quantidade });
  });
  return { linhas: linhas, total: total, km: rota.principal.km };
}

function BP2_calcularExclusivo(dados, rota, pedagio) {
  var kmExclusivo = rota.exclusivo.total || 0;
  var valorKm = Math.round(kmExclusivo * BP2_CALC.VALOR_KM_EXCLUSIVO);
  var adicionalPets = dados.qtdPets * BP2_CALC.ADICIONAL_POR_PET_EXCLUSIVO;
  var total = Math.round(valorKm + adicionalPets + (Number(pedagio) || 0));
  return { kmExclusivo: kmExclusivo, valorKm: valorKm, adicionalPets: adicionalPets, pedagio: Number(pedagio) || 0, total: total };
}

function BP2_calcularRotas(origem, destino, kmInformadoTexto) {
  var principal = BP2_calcularKmTrechoSeguro(origem, destino, kmInformadoTexto);
  var t1 = BP2_calcularKmTrechoSeguro(BP2_CALC.BASE_EXCLUSIVO, origem, 0);
  var t2 = principal;
  var t3 = BP2_calcularKmTrechoSeguro(destino, BP2_CALC.BASE_EXCLUSIVO, 0);
  var total = (t1.km || 0) + (t2.km || 0) + (t3.km || 0);
  return { principal: principal, exclusivo: { total: total, trecho1: t1, trecho2: t2, trecho3: t3, ok: total > 0 && t1.km > 0 && t2.km > 0 && t3.km > 0 } };
}

function BP2_calcularKmTrechoSeguro(origem, destino, kmInformadoTexto) {
  origem = BP2_limparCidade(origem);
  destino = BP2_limparCidade(destino);
  var manual = BP2_kmManual(origem, destino);
  if (manual) return { km: manual, fonte: "manual", origem: origem, destino: destino };
  var api = BP2_kmOSRM(origem, destino);
  if (api > 0) return { km: Math.round(api), fonte: "OSRM/API", origem: origem, destino: destino };
  if (kmInformadoTexto && Number(kmInformadoTexto) > 0) return { km: Number(kmInformadoTexto), fonte: "informado pelo cliente", origem: origem, destino: destino };
  return { km: 0, fonte: "erro", origem: origem, destino: destino };
}

function BP2_kmManual(origem, destino) {
  var rotas = {
    "SAO BERNARDO DO CAMPO SP|SAO PAULO SP": 25,
    "SAO PAULO SP|SAO BERNARDO DO CAMPO SP": 25,
    "SAO PAULO SP|PARAPUA SP": 602,
    "PARAPUA SP|SAO PAULO SP": 602,
    "PARAPUA SP|SAO BERNARDO DO CAMPO SP": 625,
    "SAO BERNARDO DO CAMPO SP|PARAPUA SP": 625
  };
  return rotas[BP2_chaveCidade(origem) + "|" + BP2_chaveCidade(destino)] || null;
}

function BP2_kmOSRM(origem, destino) {
  try {
    var co = BP2_coord(origem);
    var cd = BP2_coord(destino);
    if (!co || !cd) return 0;
    var url = "https://router.project-osrm.org/route/v1/driving/" + co.lon + "," + co.lat + ";" + cd.lon + "," + cd.lat + "?overview=false";
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var json = JSON.parse(resp.getContentText());
    return json.code === "Ok" && json.routes && json.routes[0] ? json.routes[0].distance / 1000 : 0;
  } catch (e) {
    return 0;
  }
}

function BP2_coord(cidade) {
  try {
    cidade = BP2_limparCidade(cidade);
    if (!cidade) return null;
    var cidadeVirgula = cidade.replace(/\s+(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/i, ", $1");
    var tentativas = [cidadeVirgula + ", Brasil", cidade + ", Brasil", cidadeVirgula, cidade];
    for (var i = 0; i < tentativas.length; i++) {
      var url = "https://nominatim.openstreetmap.org/search?format=json&limit=3&countrycodes=br&addressdetails=1&q=" + encodeURIComponent(tentativas[i]);
      var resp = UrlFetchApp.fetch(url, { headers: { "User-Agent": "BeloPet/1.0", "Accept-Language": "pt-BR" }, muteHttpExceptions: true });
      var arr = JSON.parse(resp.getContentText());
      if (arr && arr[0]) return { lat: arr[0].lat, lon: arr[0].lon, display_name: arr[0].display_name };
    }
    return null;
  } catch (e) {
    return null;
  }
}

function BP2_montarMensagem(dados, comp, excl, rota) {
  var origem = BP2_formatarCidade(dados.origem);
  var destino = BP2_formatarCidade(dados.destino);
  var qtdTxt = dados.qtdPets === 1 ? "1 pet" : dados.qtdPets + " pets";
  var icone = dados.temCao && dados.temGato ? "ðŸ¾" : (dados.temGato ? "ðŸ±" : "ðŸ¶");
  var petsDesc = dados.pets.map(function(p){ return (p.quantidade > 1 ? p.quantidade + "x " : "") + BP2_descPet(p); }).join(" + ");
  var prazo = BP2_prazo(rota.principal.km); // prazo exibido considera origem â†’ destino com pet a bordo

  var intro = "Vamos lÃ¡! ðŸ˜Š Vou te explicar direitinho como funciona o transporte para o seu pet:\n\n" + icone + " Pets: " + petsDesc + "\n\n";
  var cuidados = "ðŸ“ LocalizaÃ§Ã£o em tempo real\nâ±ï¸ Paradas para cuidados a cada 4 horas\nðŸ’§ Ãgua disponÃ­vel durante toda a viagem\nðŸ§¼ Tapetes higiÃªnicos e higienizaÃ§Ã£o constante\nâ„ï¸ Van com ar-condicionado ligado o tempo todo\n\n";
  var docs = "ðŸ“‹ Para viajar, Ã© necessÃ¡rio:\n\nCarteirinha de vacinaÃ§Ã£o atualizada\nAtestado veterinÃ¡rio\nEnvie raÃ§Ã£o suficiente para todos os dias de viagem\nAs vacinas obrigatÃ³rias devem estar dentro do prazo de validade e registradas na carteirinha (a vacinaÃ§Ã£o Ã© anual)\n\n";
  var rodape = "ðŸ“² Veja como funciona nosso transporte:\nInstagram: https://www.instagram.com/p/DV6SKPKDKqm/?igsh=MW9zajNvNmJ5Znc0\nSite: www.belopet.com.br\n\nðŸ“¸ Instagram: @aletaxipet\n\nâœ¨ Desde 2013\nðŸŽ–ï¸ Ã“timas avaliaÃ§Ãµes\n\nDesde 2013 transportando pets com carinho, conforto e seguranÃ§a! ðŸ¶ðŸ±ðŸš";

  var linhasComp = comp.linhas.map(function(l){ return "ðŸ’° " + l.descricao + ": *" + BP2_moeda(l.valorUnitario) + (l.quantidade > 1 ? " cada" : "") + "*"; }).join("\n");
  var txtComp = "ðŸ”¹ OPÃ‡ÃƒO â€” COMPARTILHADO ðŸ”¹\n\n" +
    "ðŸš Transporte Pet â€“ " + origem + " atÃ© " + destino + "\n\n" +
    linhasComp + "\n" +
    "ðŸ’° Valor total (" + qtdTxt + "): *" + BP2_moeda(comp.total) + "*\n" +
    "ðŸ•’ Tempo aproximado de transporte: " + prazo + "\n\n" +
    "ðŸ¾ Transporte compartilhado com outros pets, cada um acomodado em caixa de transporte individual fornecida por nÃ³s e higienizada antes de cada viagem.\n\n" +
    "ðŸ“ Trabalhamos com pontos de encontro para retirada e entrega, mas tambÃ©m oferecemos serviÃ§o porta a porta com taxa adicional.\n\n" +
    cuidados + docs + rodape;

  var txtExcl = "ðŸ”¹ OPÃ‡ÃƒO â€” EXCLUSIVO ðŸ”¹\n\n" +
    "ðŸš Transporte Pet â€“ " + origem + " atÃ© " + destino + "\n\n" +
    "ðŸ’° Valor total (" + qtdTxt + "): *" + BP2_moeda(excl.total) + "*\n" +
    "ðŸ•’ Tempo aproximado de transporte: " + prazo + "\n\n" +
    "ðŸ¾ Transporte exclusivo. Apenas o(s) seu(s) pet(s) acompanha(m) o transporte.\n" +
    "ðŸ¾ Os pets viajam em caixas de transporte individuais fornecidas pela BeloPet e higienizadas antes de cada viagem.\n" +
    "ðŸ“ Retirada e entrega porta a porta\n\n" +
    cuidados + docs + rodape;

  if (dados.modalidade === "compartilhado") return intro + txtComp;
  if (dados.modalidade === "exclusivo") return intro + txtExcl;
  return intro + "ðŸš Transporte Pet â€“ " + origem + " atÃ© " + destino + "\n\nPara seu caso, temos 2 opÃ§Ãµes de transporte:\n\n" + txtComp + "\n\n" + txtExcl;
}

function BP2_montarDiagnostico(dados, rota, comp, excl) {
  var caes = dados.pets.filter(function(p){ return p.especie === "cao"; }).reduce(function(s,p){ return s + p.quantidade; }, 0);
  var gatos = dados.pets.filter(function(p){ return p.especie === "gato"; }).reduce(function(s,p){ return s + p.quantidade; }, 0);
  var linhas = [];
  linhas.push("ðŸ“‹ Dados interpretados", "");
  linhas.push("Modalidade: " + dados.modalidade);
  linhas.push("Origem: " + dados.origem);
  linhas.push("Destino: " + dados.destino, "");
  linhas.push("Pets identificados: " + dados.qtdPets);
  linhas.push("ðŸ¶ CÃ£es: " + caes);
  linhas.push("ðŸ± Gatos: " + gatos, "");
  linhas.push("Detalhes:");
  dados.pets.forEach(function(p){ linhas.push("â€¢ " + p.quantidade + " " + BP2_descPet(p)); });
  linhas.push("", "KM origem â†’ destino: " + Math.round(rota.principal.km || 0) + " km [" + rota.principal.fonte + "]");
  linhas.push("KM exclusivo total: " + Math.round(rota.exclusivo.total || 0) + " km");
  linhas.push("SBC â†’ origem: " + Math.round((rota.exclusivo.trecho1 && rota.exclusivo.trecho1.km) || 0) + " km [" + ((rota.exclusivo.trecho1 && rota.exclusivo.trecho1.fonte) || "") + "]");
  linhas.push("Origem â†’ destino: " + Math.round((rota.exclusivo.trecho2 && rota.exclusivo.trecho2.km) || 0) + " km [" + ((rota.exclusivo.trecho2 && rota.exclusivo.trecho2.fonte) || "") + "]");
  linhas.push("Destino â†’ SBC: " + Math.round((rota.exclusivo.trecho3 && rota.exclusivo.trecho3.km) || 0) + " km [" + ((rota.exclusivo.trecho3 && rota.exclusivo.trecho3.fonte) || "") + "]");
  linhas.push("Compartilhado total: " + BP2_moeda(comp.total));
  linhas.push("Exclusivo total: " + BP2_moeda(excl.total));
  if (dados.inconsistencias.length) linhas.push("", "âš ï¸ " + dados.inconsistencias.join("\nâš ï¸ "));
  return linhas.join("\n");
}

function BP2_montarPayloadCRM(payload, dados, comp, excl, msg) {
  return {
    acao: "orcamento_crm",
    dataOrcamento: BP2_dataHojeBR(),
    nome: payload.nomeCliente || dados.nomeCliente || "",
    telefone: BP2_limparTelefone(payload.telefoneCliente || dados.telefoneCliente || ""),
    tipoCliente: payload.tipoCliente || dados.tipoCliente || "Outro",
    origem: BP2_formatarCidade(dados.origem),
    destino: BP2_formatarCidade(dados.destino),
    modalidade: dados.modalidade,
    pet: dados.pets.map(function(p){ return (p.quantidade > 1 ? p.quantidade + "x " : "") + BP2_descPet(p); }).join(" + "),
    qtdPets: dados.qtdPets,
    km: Math.round(dados.km || 0),
    valorCompartilhado: comp.total,
    valorExclusivo: excl.total,
    status: "Aguardando",
    ultimoContato: BP2_dataHojeBR(),
    proximoFollowUp: BP2_somarDiasBR(3),
    origemLead: payload.origemLead || "",
    dataViagem: payload.dataViagem || dados.dataViagem || "",
    mensagemWhatsApp: msg
  };
}

function BP2_salvarCRM(payload) {
  try {
    UrlFetchApp.fetch(BP2_CALC.CRM_WEBAPP_URL, {
      method: "post",
      contentType: "text/plain;charset=utf-8",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {}
}

/* Helpers */
function BP2_norm(s){ return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
function BP2_qtd(n){ n = parseInt(n, 10); return isFinite(n) && n >= 1 && n <= 20 ? n : 0; }
function BP2_num(v){ var n = Number(String(v || "").replace(",", ".").replace(/[^\d.]/g, "")); return isFinite(n) && n > 0 ? n : 0; }
function BP2_totalPets(pets){ return (pets || []).reduce(function(s,p){ return s + (parseInt(p.quantidade, 10) || 1); }, 0); }
function BP2_textoSemTelefones(t){ return String(t || "").replace(/\+?55\s*/g, " ").replace(/\(?\b\d{2}\)?[\s.\-]*9?\d{4}[\s.\-]*\d{4}\b/g, " ").replace(/\b\d{6,}\b/g, " "); }
function BP2_limparTelefone(v){ return String(v || "").replace(/\D/g, ""); }
function BP2_limparCidade(v){ return String(v || "").replace(/["']/g, "").replace(/\s*\/\s*/g, " ").replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim(); }
function BP2_chaveCidade(cidade){ return BP2_limparCidade(cidade).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\b(BRASIL|BR|CEP|CAPITAL|CIDADE|MUNICIPIO|BAIRRO)\b/g, "").replace(/\s+/g, " ").trim(); }
function BP2_moeda(v){ return Math.round(Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function BP2_formatarCidade(v){ return String(v || "").trim().toLowerCase().replace(/(^|\s)(\S)/g, function(_,a,b){ return a + b.toUpperCase(); }).replace(/\b(Sp|Rj|Mg|Es|Pr|Sc|Rs|Ba|Se|Al|Pe|Pb|Rn|Ce|Go|Df)\b/g, function(m){ return m.toUpperCase(); }); }
function BP2_dataHojeBR(){ var d = new Date(); return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear(); }
function BP2_somarDiasBR(dias){ var d = new Date(); d.setDate(d.getDate() + dias); return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear(); }
function BP2_prazo(km){ km = Number(km) || 0; if (km <= 350) return "atÃ© 24 horas"; if (km <= 700) return "1 dia"; var b = Math.max(1, Math.ceil(km / 1200)); return b + " a " + (b + 1) + " dias"; }
function BP2_descPet(p){ var partes = [p.raca || (p.especie === "gato" ? "Gato" : "CÃ£o")]; if (p.idade) partes.push(p.idade); if (p.pesoKg) partes.push("aprox. " + p.pesoKg + " kg"); if (p.especie === "cao" && p.porte) partes.push({ PP:"porte PP", P:"porte pequeno", M:"porte mÃ©dio", G:"porte grande", GG:"porte GG" }[p.porte] || "porte mÃ©dio"); return partes.join(" â€¢ "); }
function BP2_racaNormalizada(raca, especie){ var t = BP2_norm(raca); if (especie === "gato") return /srd|vira lata|viralata|sem raca/.test(t) ? "Gato SRD" : "Gato"; if (/srd|vira lata|viralata|sem raca/.test(t)) return "CÃ£o SRD"; if (/pincher|pinche|pinscher/.test(t)) return "Pinscher"; if (/shitzu|shih/.test(t)) return "Shih Tzu"; if (/bernese|bernesse/.test(t)) return "Bernese Mountain Dog"; if (/bull terrier/.test(t)) return "Bull Terrier"; if (/husky|huskies/.test(t)) return "Husky Siberiano"; if (/chow/.test(t)) return "Chow Chow"; if (/poodle/.test(t)) return "Poodle"; if (/golden/.test(t)) return "Golden Retriever"; if (/labrador/.test(t)) return "Labrador"; if (/pastor/.test(t)) return "Pastor AlemÃ£o"; if (/bully|pit/.test(t)) return "American Bully/Pit Bull"; return raca || "CÃ£o"; }
function BP2_portePet(porte, raca, peso, texto){ var p = String(porte || "").toUpperCase(); if (["PP", "P", "M", "G", "GG"].indexOf(p) >= 0) return p; peso = Number(peso) || 0; if (peso > 0) { if (peso <= 6) return "P"; if (peso <= 18) return "M"; if (peso <= 35) return "G"; return "GG"; } var t = BP2_norm([raca, texto].join(" ")); if (/pp|toy|mini/.test(t)) return "PP"; if (/pequeno|pinscher|shih|spitz|poodle/.test(t)) return "P"; if (/grande|husky|golden|labrador|pastor|chow|bernese|bully|pit/.test(t)) return "G"; return "M"; }
function BP2_detectarRotaNordesteSudeste(origem, destino){ var ne = ["BA","SE","AL","PE","PB","RN","CE","PI","MA"]; var ss = ["SP","RJ","MG","ES","PR","SC","RS"]; origem = String(origem || "").toUpperCase(); destino = String(destino || "").toUpperCase(); return ne.some(function(uf){ return origem.endsWith(" " + uf) || origem.indexOf("/" + uf) >= 0; }) && ss.some(function(uf){ return destino.endsWith(" " + uf) || destino.indexOf("/" + uf) >= 0; }); }
function BP2_extrairTelefone(t){ var m = String(t || "").match(/(?:\+?55\s*)?(\d{2})[\s().-]*(9?\d{4})[\s.-]*(\d{4})/); return m ? m[1] + m[2] + m[3] : ""; }
function BP2_extrairNome(t){ return ""; }
function BP2_extrairTipoCliente(t){ t = BP2_norm(t); if (/mudanca/.test(t)) return "MudanÃ§a"; if (/filhote|canil|criador/.test(t)) return "Filhote"; return "Outro"; }
function BP2_extrairData(t){ var m = String(t || "").match(/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/); return m ? m[0].replace(/-/g, "/") : ""; }
function BP2_extrairKmInformado(t){ var m = String(t || "").match(/(?:aproximadamente|aprox\.?|cerca de|em torno de)?\s*(\d{2,5})\s*km\b/i); return m ? Number(m[1]) : 0; }
function BP2_extrairOrigemLocal(t){
  var s = String(t || "");
  var m = s.match(/(?:estou em|saindo de|origem|retirada)\s*[:\-â€“â€”]?\s*([^\n,.]+(?:\s+[A-Z]{2})?)/i);
  return m ? m[1].trim() : "";
}
function BP2_extrairDestinoLocal(t){
  var s = String(t || "");
  var m = s.match(/(?:para|irÃ£o para|irao para|destino|entrega)\s*[:\-â€“â€”]?\s*([^\n,.]+(?:\s+[A-Z]{2})?)/i);
  return m ? m[1].trim() : "";
}
