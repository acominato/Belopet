/***************
 * Clientes.gs â€” BeloPet â€” VERSÃƒO ESTÃVEL EMERGÃŠNCIA
 * Cadastro externo DadosClientes + CRM + busca/ediÃ§Ã£o por IDCadastro.
 * Importante: no projeto inteiro deve existir APENAS UM function doGet(e) ativo: este aqui.
 ***************/

const BP_SHEETS = {
  DADOS: "DadosClientes",
  PONTOS: "PontosEncontro",
};

const BP_SS_ID = "112Dm9XVjPwFFBkMLOC0_Q9lacmXJlAcQk3Cuh3nei64";

/* Sidebar antiga desativada. O cadastro atual usa clientes.html externo.
function BP_openDadosClientesSidebar() {}
*/

function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const callback = params.callback || "";

  try {
    const acao = String(params.acao || "").trim();

    if (!acao || acao === "ping") {
      return jsonpOutput_({ ok: true, message: "Clientes.gs ativo", agora: new Date().toISOString() }, callback);
    }

    if (acao === "buscar_dados_cliente") {
      return jsonpOutput_(buscarDadosCliente_(params.termo || ""), callback);
    }
    if (acao === "gerar_contrato_cliente") {
      return jsonpOutput_(gerarContratoClienteWeb_(params.idCadastro || ""), callback);
    }

    return jsonpOutput_({ ok: false, message: "AÃ§Ã£o GET nÃ£o reconhecida: " + acao }, callback);
  } catch (err) {
    return jsonpOutput_({ ok: false, message: "Erro no doGet: " + (err && err.message ? err.message : err) }, callback);
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) ? e.postData.contents : "{}");
    const acao = String(payload.acao || "").trim();

    if (acao === "atualizar_dados_cliente") return jsonOutput_(atualizarDadosCliente_(payload));
    if (acao === "incluir_dados_cliente") return jsonOutput_(salvarDados(payload));

    const pareceCRM = acao === "orcamento_crm" || payload.modalidade || payload.valorCompartilhado || payload.valorExclusivo || payload.mensagemWhatsApp;
    if (pareceCRM) return jsonOutput_(salvarOrcamentoCRM_(payload));

    return jsonOutput_(salvarDados(payload));
  } catch (err) {
    return jsonOutput_({ ok: false, message: "Erro no doPost: " + (err && err.message ? err.message : err) });
  }
}

function buscarDadosCliente_(termo) {
  termo = String(termo || "").trim();
  if (!termo) return { ok: false, message: "Informe ID, telefone, CPF ou nome para buscar.", resultados: [] };

  const ss = SpreadsheetApp.openById(BP_SS_ID);
  const sh = ss.getSheetByName(BP_SHEETS.DADOS);
  if (!sh) throw new Error('Aba "DadosClientes" nÃ£o encontrada.');

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok: true, resultados: [] };

  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const headerMap = buildHeaderMap_(headers);
  const display = sh.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
  const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const termoNorm = normalizarBusca_(termo);
  const termoDig = somenteDigitos_(termo);
  const resultados = [];

  for (let i = 0; i < display.length; i++) {
    const rowNumber = i + 2;
    const rowDisplay = display[i];
    const rowValues = values[i];

    const idCadastro = cellFlex_(rowDisplay, rowValues, headerMap, ["IDCadastro", "ID Cadastro"]);
    const nome = cellFlex_(rowDisplay, rowValues, headerMap, ["Nome"]);
    const telefone = cellFlex_(rowDisplay, rowValues, headerMap, ["Telefone", "Telefone Cliente", "Celular", "WhatsApp", "Whatsapp", "Fone"]);
    const cpf = cellFlex_(rowDisplay, rowValues, headerMap, ["CPF", "Cpf", "CPF do contratante", "Documento", "Documento CPF"]);
    const dePara = cellFlex_(rowDisplay, rowValues, headerMap, ["DE/PARA", "De Para"]);
    const dadosPet = cellFlex_(rowDisplay, rowValues, headerMap, ["Dados Pet"]);

    const blocoTexto = normalizarBusca_([idCadastro, nome, telefone, cpf, normalizarCPF_(cpf), dePara, dadosPet].join(" "));
    const blocoDig = somenteDigitos_([idCadastro, telefone, cpf, normalizarCPF_(cpf)].join(" "));

    const bateTexto = termoNorm && blocoTexto.indexOf(termoNorm) !== -1;
    const bateDigitos = termoDig.length >= 3 && blocoDig.indexOf(termoDig) !== -1;

    if (bateTexto || bateDigitos) {
      resultados.push(montarRegistroCliente_(rowNumber, rowDisplay, rowValues, headerMap, headers));
      if (resultados.length >= 30) break;
    }
  }

  return { ok: true, resultados: resultados };
}

function montarRegistroCliente_(rowNumber, rowDisplay, rowValues, headerMap, headers) {
  function vf(nomes) { return cellFlex_(rowDisplay, rowValues, headerMap, nomes); }

  return {
    linhaEdicao: rowNumber,
    idCadastro: vf(["IDCadastro", "ID Cadastro"]),
    dataViagem: vf(["Data Viagem"]),
    dePara: vf(["DE/PARA", "De Para"]),
    sentido: vf(["Sentido"]),
    nome: vf(["Nome"]),
    telefone: limparApostrofo_(vf(["Telefone", "Telefone Cliente", "Celular", "WhatsApp", "Whatsapp", "Fone"])),
    cpf: vf(["CPF"]), //limparApostrofo_(vf(["CPF", "Cpf", "CPF do contratante", "Documento", "Documento CPF"])),
    email: vf(["Email", "E-mail"]),
    endContratante: vf(["EndereÃ§o do contratante", "Endereco do contratante", "EndereÃ§o Contratante", "Endereco Contratante"]),
    dadosPet: vf(["Dados Pet"]),
    qtdePets: vf(["Qtde Pets", "Qtd Pets", "Quantidade Pets"]),
    caixa: vf(["Caixa"]),
    respEmbarque: vf(["ResponsÃ¡vel no Embarque", "Responsavel no Embarque"]),
    telRespEmbarque: limparApostrofo_(vf(["Telefone Resp Embarque", "Telefone ResponsÃ¡vel no Embarque", "Telefone Responsavel no Embarque", "Tel Resp Embarque"])),
    pee: vf(["PEE?", "PEE"]),
    localEmbarque: vf(["Local de Embarque"]),
    coleta: vf(["Coleta"]),
    respDesembarque: vf(["ResponsÃ¡vel da Desembarque", "Responsavel da Desembarque", "ResponsÃ¡vel no Desembarque", "Responsavel no Desembarque"]),
    telRespDesembarque: limparApostrofo_(vf(["Telefone Resp Desembarque", "Telefone ResponsÃ¡vel da Desembarque", "Telefone Responsavel da Desembarque", "Tel Resp Desembarque"])),
    ped: vf(["PED?", "PED"]),
    localDesembarque: vf(["Local de Desembarque"]),
    valorAcordado: vf(["Valor acordado"]),
    sinal: vf(["Sinal"]),
    restante: vf(["Restante"]),
    valorPendente: vf(["Restante", "Valor Pendente"]),
    obs: vf(["Obs", "ObservaÃ§Ã£o", "Observacao"]),
    linkContrato: vf(["Link Contrato"]),
    enviado: vf(["Enviado?", "Enviado"]),
    contratoGerado: vf(["ContratoGerado", "Contrato Gerado"]),
    falta: vf(["falta", "Falta"]),
    _debugCampos: montarDebugCamposLinha_(rowDisplay, rowValues, headers),
    _debugResumo: "Linha " + rowNumber + " retornada com " + headers.length + " colunas"
  };
}

function salvarDados(payload) {
  try {
    const ss = SpreadsheetApp.openById(BP_SS_ID);
    const sh = ss.getSheetByName(BP_SHEETS.DADOS);
    if (!sh) throw new Error('Aba "DadosClientes" nÃ£o encontrada.');

    const headerMap = getHeaderMapFromSheet_(sh);
    const lastRow = sh.getLastRow();
    sh.insertRowAfter(lastRow);
    const rowIndex = lastRow + 1;

    if (!payload.idCadastro) payload.idCadastro = gerarProximoIDCadastro_(sh, headerMap);

    gravarPayloadDadosClienteNaLinha_(sh, headerMap, rowIndex, payload, { modo: "incluir", preservarCamposGeradosVazios: false });

    return { ok: true, row: rowIndex, idCadastro: payload.idCadastro, message: "Cadastro salvo âœ…" };
  } catch (e) {
    return { ok: false, message: "Erro ao salvar cadastro: " + (e && e.message ? e.message : e) };
  }
}

function atualizarDadosCliente_(payload) {
  try {
    const ss = SpreadsheetApp.openById(BP_SS_ID);
    const sh = ss.getSheetByName(BP_SHEETS.DADOS);
    if (!sh) throw new Error('Aba "DadosClientes" nÃ£o encontrada.');

    const headerMap = getHeaderMapFromSheet_(sh);
    const rowIndex = localizarLinhaParaAtualizar_(sh, headerMap, payload);
    if (!rowIndex || rowIndex < 2) throw new Error("Cadastro nÃ£o localizado para atualizaÃ§Ã£o. Busque novamente antes de salvar.");

    gravarPayloadDadosClienteNaLinha_(sh, headerMap, rowIndex, payload, { modo: "atualizar", preservarCamposGeradosVazios: true });

    return { ok: true, row: rowIndex, idCadastro: payload.idCadastro || "", message: "Cadastro atualizado âœ…" };
  } catch (e) {
    return { ok: false, message: "Erro ao atualizar cadastro: " + (e && e.message ? e.message : e) };
  }
}

function localizarLinhaParaAtualizar_(sh, headerMap, payload) {
  const idCadastro = String(payload.idCadastro || "").trim();
  if (idCadastro) {
    const idx = findHeaderIndex_(headerMap, "IDCadastro") ?? findHeaderIndex_(headerMap, "ID Cadastro");
    if (idx === undefined) throw new Error('Coluna "IDCadastro" nÃ£o encontrada.');

    const lastRow = sh.getLastRow();
    const ids = sh.getRange(2, idx + 1, Math.max(0, lastRow - 1), 1).getDisplayValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0] || "").trim().toUpperCase() === idCadastro.toUpperCase()) return i + 2;
    }
    throw new Error("IDCadastro nÃ£o encontrado: " + idCadastro);
  }

  const rowIndex = Number(payload.linhaEdicao || payload.row || payload.linha);
  if (rowIndex && rowIndex >= 2 && rowIndex <= sh.getLastRow()) return rowIndex;
  return null;
}

function gravarPayloadDadosClienteNaLinha_(sh, headerMap, rowIndex, payload, opcoes) {
  opcoes = opcoes || {};
  const SKIP_COLS = new Set([26]);

  const valorAcordado = toNumberBR_(payload.valorAcordado);
  const sinal = toNumberBR_(payload.sinal);
  let restante = valorAcordado - sinal;
  if (!isFinite(restante)) restante = 0;
  restante = Math.round(restante);

  function setByHeader(headerName, value, opt) {
    opt = opt || {};
    const idx = findHeaderIndex_(headerMap, headerName);
    if (idx === undefined) return;
    const col = idx + 1;
    if (SKIP_COLS.has(col)) return;
    if (opt.preservarSeVazio && (value === "" || value === null || value === undefined)) return;
    sh.getRange(rowIndex, col).setValue(value ?? "");
  }

  setByHeader("IDCadastro", payload.idCadastro);
  setByHeader("Data Viagem", payload.dataViagem);
  setByHeader("DE/PARA", payload.dePara);
  setByHeader("Sentido", payload.sentido);
  setByHeader("Nome", payload.nome);
  setByHeader("Endereço do contratante", payload.endContratante);
  //setByHeader("CPF", payload.cpf ? "'" + normalizarCPF_(payload.cpf) : "");
  setByHeader("CPF", payload.cpf ? normalizarCPF_(payload.cpf) : "");
  setByHeader("Telefone", payload.telefone ? "'" + limparTelefoneTexto_(payload.telefone) : "");
  setByHeader("Email", payload.email);
  setByHeader("Dados Pet", payload.dadosPet);
  setByHeader("Qtde Pets", payload.qtdePets);
  setByHeader("Caixa", payload.caixa);
  setByHeader("Responsável no Embarque", payload.respEmbarque);
  setByHeader("Telefone Resp Embarque", payload.telRespEmbarque ? "'" + limparTelefoneTexto_(payload.telRespEmbarque) : "");
  setByHeader("PEE?", payload.pee);
  setByHeader("Local de Embarque", payload.localEmbarque);
  setByHeader("Coleta", payload.coleta);
  setByHeader("Responsável da Desembarque", payload.respDesembarque);
  setByHeader("Telefone Resp Desembarque", payload.telRespDesembarque ? "'" + limparTelefoneTexto_(payload.telRespDesembarque) : "");
  setByHeader("PED?", payload.ped);
  setByHeader("Local de Desembarque", payload.localDesembarque);
  setByHeader("Valor acordado", valorAcordado);
  setByHeader("Sinal", sinal);
  setByHeader("Restante", restante);
  setByHeader("Obs", payload.obs);

  const preservar = !!opcoes.preservarCamposGeradosVazios;
  setByHeader("Link Contrato", payload.linkContrato, { preservarSeVazio: preservar });
  setByHeader("Enviado?", payload.enviado, { preservarSeVazio: preservar });
  setByHeader("ContratoGerado", payload.contratoGerado, { preservarSeVazio: preservar });
  setByHeader("Restante", payload.falta, { preservarSeVazio: preservar });
}

function salvarOrcamentoCRM_(dados) {
  try {
    const ss = SpreadsheetApp.openById(BP_SS_ID);
    const agora = new Date();
    const proximo = new Date(agora);
    proximo.setDate(proximo.getDate() + 3);
    const id = dados.id || ("ORC" + Utilities.getUuid().slice(0, 8).toUpperCase());

    salvarLinhaPorCabecalho_(ss, "ORCAMENTOS_CRM", {
      ID: id,
      DataOrcamento: dados.dataOrcamento || agora,
      Nome: dados.nome || "",
      Telefone: dados.telefone || "",
      TipoCliente: dados.tipoCliente || "",
      Origem: dados.origem || "",
      Destino: dados.destino || "",
      Modalidade: dados.modalidade || "",
      Pet: dados.pet || "",
      QtdePets: dados.qtdPets || "",
      KM: dados.km || "",
      ValorCompartilhado: dados.valorCompartilhado || "",
      ValorExclusivo: dados.valorExclusivo || "",
      Status: dados.status || "Aguardando",
      Motivo: dados.motivo || "",
      UltimoContato: dados.ultimoContato || agora,
      ProximoFollowUp: dados.proximoFollowUp || proximo,
      OrigemLead: dados.origemLead || "",
      DataViagem: dados.dataViagem || "",
      MensagemWhatsApp: dados.mensagemWhatsApp || ""
    });

    salvarLinhaPorCabecalho_(ss, "FOLLOWUP", {
      Nome: dados.nome || "",
      Telefone: dados.telefone || "",
      "Dias sem Contato": 0,
      Status: dados.status || "Aguardando"
    });

    return { ok: true, message: "OrÃ§amento salvo no CRM e FOLLOWUP âœ…" };
  } catch (e) {
    return { ok: false, message: "Erro ao salvar orÃ§amento CRM: " + (e && e.message ? e.message : e) };
  }
}

function salvarLinhaPorCabecalho_(ss, nomeAba, registro) {
  const sh = ss.getSheetByName(nomeAba);
  if (!sh) throw new Error('Aba "' + nomeAba + '" nÃ£o encontrada.');
  const headerMap = getHeaderMapFromSheet_(sh);
  const lastRow = sh.getLastRow();
  sh.insertRowAfter(lastRow);
  const rowIndex = lastRow + 1;
  Object.keys(registro).forEach(campo => {
    const idx = findHeaderIndex_(headerMap, campo);
    if (idx !== undefined) sh.getRange(rowIndex, idx + 1).setValue(registro[campo]);
  });
}

function getHeaderMapFromSheet_(sh) {
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (!headers || headers.length === 0) throw new Error("CabeÃ§alho da aba " + sh.getName() + " estÃ¡ vazio.");
  return buildHeaderMap_(headers);
}

function cellFlex_(rowDisplay, rowValues, headerMap, nomes) {
  for (let i = 0; i < nomes.length; i++) {
    const idx = findHeaderIndex_(headerMap, nomes[i]);
    if (idx === undefined) continue;
    const display = rowDisplay && rowDisplay[idx] !== null && rowDisplay[idx] !== undefined ? String(rowDisplay[idx]).trim() : "";
    if (display) return display;
    const raw = rowValues && rowValues[idx] !== null && rowValues[idx] !== undefined ? String(rowValues[idx]).trim() : "";
    if (raw) return raw;
  }
  return "";
}

function montarDebugCamposLinha_(rowDisplay, rowValues, headers) {
  const campos = [];
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i] === null || headers[i] === undefined ? "" : String(headers[i]).trim();
    if (!header) continue;
    campos.push({
      coluna: i + 1,
      cabecalho: header,
      display: rowDisplay && rowDisplay[i] !== null && rowDisplay[i] !== undefined ? String(rowDisplay[i]) : "",
      bruto: rowValues && rowValues[i] !== null && rowValues[i] !== undefined ? String(rowValues[i]) : ""
    });
  }
  return campos;
}

function gerarProximoIDCadastro_(sh, headerMap) {
  const idx = findHeaderIndex_(headerMap, "IDCadastro") ?? findHeaderIndex_(headerMap, "ID Cadastro");
  if (idx === undefined) return "ID-" + Utilities.getUuid().slice(0, 8).toUpperCase();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return "ID-001";
  const ids = sh.getRange(2, idx + 1, lastRow - 1, 1).getDisplayValues();
  let maior = 0;
  ids.forEach(r => {
    const m = String(r[0] || "").trim().match(/^ID-(\d+)$/i);
    if (m) maior = Math.max(maior, Number(m[1]));
  });
  return "ID-" + String(maior + 1).padStart(3, "0");
}

function normalizarCPF_(cpf) {
  const apenasNumeros = String(cpf || "").replace(/\D/g, "");
  if (!apenasNumeros) return "";
  return apenasNumeros.padStart(11, "0").slice(-11);
}

function limparTelefoneTexto_(v) {
  return String(v || "").replace(/[^\d+]/g, "");
}

function limparApostrofo_(v) {
  return String(v || "").replace(/^'/, "").trim();
}

function toNumberBR_(v) {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).trim().replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

function buildHeaderMap_(headers) {
  const map = {};
  headers.forEach((h, idx) => {
    const key = normHeader_(h);
    if (key) map[key] = idx;
  });
  return map;
}

function findHeaderIndex_(headerMap, headerName) {
  const base = normHeader_(headerName);
  if (headerMap[base] !== undefined) return headerMap[base];
  const semInterrogacao = base.replace(/\?/g, "").trim();
  if (headerMap[semInterrogacao] !== undefined) return headerMap[semInterrogacao];
  return undefined;
}

function normHeader_(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\?/g, "")
    .replace(/\s+/g, " ");
}

function normalizarBusca_(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s@.+\/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function somenteDigitos_(s) {
  return String(s || "").replace(/\D/g, "");
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function jsonpOutput_(obj, callback) {
  callback = String(callback || "").replace(/[^a-zA-Z0-9_$\.]/g, "");
  if (callback) {
    return ContentService.createTextOutput(callback + "(" + JSON.stringify(obj) + ");").setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonOutput_(obj);
}
