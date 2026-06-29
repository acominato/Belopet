/***************
 * Clientes.gs â€” BeloPet
 * DadosClientes + CRM
 * Inclui e atualiza cadastros por IDCadastro
 ***************/

const BP_SPREADSHEET_ID = "112Dm9XVjPwFFBkMLOC0_Q9lacmXJlAcQk3Cuh3nei64";

const BP_SHEETS = {
  DADOS: "DadosClientes",
  PONTOS: "PontosEncontro",
};

function BP_openDadosClientesSidebar() {
  const html = HtmlService.createHtmlOutputFromFile("Sidebar")
    .setTitle("Cadastro â€” DadosClientes");
  SpreadsheetApp.getUi().showSidebar(html);
}

function getFormMeta() {
  return {
    sentidos: ["SOBE", "DESCE", "SPSUL", "DF", "â€”"],
    simNao: ["S", "N", "â€”"],
  };
}

function getPontosEncontro() {
  const ss = SpreadsheetApp.openById(BP_SPREADSHEET_ID);
  const sh = ss.getSheetByName(BP_SHEETS.PONTOS);
  if (!sh) return [];

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const data = sh.getRange(2, 1, lastRow - 1, 5).getValues();

  const lista = data
    .map(r => ({
      id: r[0],
      local: r[1],
      endereco: r[2],
      cidade: r[3],
      estado: r[4],
    }))
    .filter(p => p && (p.local || p.endereco || p.cidade || p.estado));

  lista.sort((a, b) => {
    const ca = String(a.cidade || "").toLowerCase();
    const cb = String(b.cidade || "").toLowerCase();
    if (ca < cb) return -1;
    if (ca > cb) return 1;
    return String(a.local || "").localeCompare(String(b.local || ""));
  });

  return lista;
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const acao = String(payload.acao || "").trim();

    let resultado;

    if (acao === "orcamento_crm" || parecePayloadCRM_(payload)) {
      resultado = salvarOrcamentoCRM_(payload);
    } else if (acao === "atualizar_dados_cliente") {
      resultado = atualizarDadosCliente_(payload);
    } else {
      resultado = salvarDados(payload);
    }

    return ContentService
      .createTextOutput(JSON.stringify(resultado))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: false,
        message: "Erro no doPost: " + (err && err.message ? err.message : err)
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function parecePayloadCRM_(payload) {
  return !!(
    payload.modalidade ||
    payload.valorCompartilhado ||
    payload.valorExclusivo ||
    payload.mensagemWhatsApp
  );
}

function salvarDados(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.openById(BP_SPREADSHEET_ID);
    const sh = ss.getSheetByName(BP_SHEETS.DADOS);
    if (!sh) throw new Error('Aba "DadosClientes" nÃ£o encontrada.');

    const lastCol = sh.getLastColumn();
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    if (!headers || headers.length === 0) {
      throw new Error("CabeÃ§alho da aba DadosClientes estÃ¡ vazio.");
    }

    const headerMap = buildHeaderMap_(headers);

    const idCadastro = payload.idCadastro || gerarProximoIDCadastro_(sh, headerMap);

    const lastRow = sh.getLastRow();
    sh.insertRowAfter(lastRow);
    const rowIndex = lastRow + 1;

    escreverDadosClienteNaLinha_(sh, headerMap, rowIndex, payload, {
      idCadastro,
      preservarContrato: false
    });

    return {
      ok: true,
      idCadastro,
      linha: rowIndex,
      message: "Cadastro salvo com ID " + idCadastro + " âœ…"
    };

  } catch (e) {
    return {
      ok: false,
      message: "Erro ao salvar cadastro: " + (e && e.message ? e.message : e)
    };
  } finally {
    lock.releaseLock();
  }
}

function atualizarDadosCliente_(payload) {
  try {
    const ss = SpreadsheetApp.openById(BP_SPREADSHEET_ID);
    const sh = ss.getSheetByName(BP_SHEETS.DADOS);
    if (!sh) throw new Error('Aba "DadosClientes" nÃ£o encontrada.');

    const lastCol = sh.getLastColumn();
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    const headerMap = buildHeaderMap_(headers);

    const idCadastro = String(payload.idCadastro || "").trim();
    if (!idCadastro) {
      throw new Error("IDCadastro nÃ£o informado. Busque o cadastro novamente antes de atualizar.");
    }

    const rowIndex = localizarLinhaPorIDCadastro_(sh, headerMap, idCadastro);
    if (!rowIndex) {
      throw new Error("NÃ£o encontrei o IDCadastro " + idCadastro + " na aba DadosClientes.");
    }

    escreverDadosClienteNaLinha_(sh, headerMap, rowIndex, payload, {
      idCadastro,
      preservarContrato: true
    });

    return {
      ok: true,
      idCadastro,
      linha: rowIndex,
      message: "Cadastro " + idCadastro + " atualizado âœ…"
    };

  } catch (e) {
    return {
      ok: false,
      message: "Erro ao atualizar cadastro: " + (e && e.message ? e.message : e)
    };
  }
}

function escreverDadosClienteNaLinha_(sh, headerMap, rowIndex, payload, options) {
  options = options || {};
  const idCadastro = options.idCadastro || payload.idCadastro || "";
  const preservarContrato = !!options.preservarContrato;

  const SKIP_COLS = new Set([26]); // mantÃ©m regra antiga: nÃ£o escreve na coluna Z

  function setByHeader(headerName, value, opts) {
    opts = opts || {};
    const idx = findHeaderIndex_(headerMap, headerName);
    if (idx === undefined) return;

    const col = idx + 1;
    if (SKIP_COLS.has(col)) return;

    if (opts.preserveIfBlank) {
      const novo = value === null || value === undefined ? "" : String(value);
      if (novo === "") return;
    }

    sh.getRange(rowIndex, col).setValue(value ?? "");
  }

  const cpfFormatado = normalizarCPF_(payload.cpf);

  const valorAcordado = toNumberBR_(payload.valorAcordado);
  const sinal = toNumberBR_(payload.sinal);

  let restante = valorAcordado - sinal;
  if (!isFinite(restante)) restante = 0;
  restante = Math.round(restante);

  setByHeader("IDCadastro", idCadastro);

  setByHeader("Data Viagem", payload.dataViagem);
  setByHeader("DE/PARA", payload.dePara);
  setByHeader("Sentido", payload.sentido);

  setByHeader("Nome", payload.nome);
  setByHeader("EndereÃ§o do contratante", payload.endContratante);

  // CPF como texto para preservar zero Ã  esquerda
  setByHeader("CPF", cpfFormatado ? "'" + cpfFormatado : "");

  // Telefones como texto para preservar DDD/9 e evitar notaÃ§Ã£o numÃ©rica
  setByHeader("Telefone", payload.telefone ? "'" + limparTelefoneTexto_(payload.telefone) : "");
  setByHeader("Email", payload.email);

  setByHeader("Dados Pet", payload.dadosPet);
  setByHeader("Qtde Pets", payload.qtdePets);
  setByHeader("Caixa", payload.caixa);

  setByHeader("ResponsÃ¡vel no Embarque", payload.respEmbarque);
  setByHeader("Telefone Resp Embarque", payload.telRespEmbarque ? "'" + limparTelefoneTexto_(payload.telRespEmbarque) : "");
  setByHeader("PEE?", payload.pee);
  setByHeader("Local de Embarque", payload.localEmbarque);
  setByHeader("Coleta", payload.coleta);

  setByHeader("ResponsÃ¡vel da Desembarque", payload.respDesembarque);
  setByHeader("Telefone Resp Desembarque", payload.telRespDesembarque ? "'" + limparTelefoneTexto_(payload.telRespDesembarque) : "");
  setByHeader("PED?", payload.ped);
  setByHeader("Local de Desembarque", payload.localDesembarque);

  setByHeader("Valor acordado", valorAcordado);
  setByHeader("Sinal", sinal);
  setByHeader("Restante", restante);

  setByHeader("Obs", payload.obs);

  // Em ediÃ§Ã£o, preserva contrato/link/status se o front vier em branco.
  setByHeader("Link Contrato", payload.linkContrato, { preserveIfBlank: preservarContrato });
  setByHeader("Enviado?", payload.enviado, { preserveIfBlank: preservarContrato });
  setByHeader("ContratoGerado", payload.contratoGerado, { preserveIfBlank: preservarContrato });
  setByHeader("falta", payload.falta, { preserveIfBlank: preservarContrato });
}

function localizarLinhaPorIDCadastro_(sh, headerMap, idCadastro) {
  const idx = findHeaderIndex_(headerMap, "IDCadastro");
  if (idx === undefined) throw new Error('CabeÃ§alho "IDCadastro" nÃ£o encontrado.');

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  const col = idx + 1;
  const values = sh.getRange(2, col, lastRow - 1, 1).getDisplayValues();

  const alvo = normalizarIDCadastro_(idCadastro);

  for (let i = 0; i < values.length; i++) {
    if (normalizarIDCadastro_(values[i][0]) === alvo) {
      return i + 2;
    }
  }

  return null;
}

function gerarProximoIDCadastro_(sh, headerMap) {
  const idx = findHeaderIndex_(headerMap, "IDCadastro");
  if (idx === undefined) throw new Error('CabeÃ§alho "IDCadastro" nÃ£o encontrado.');

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return "ID-001";

  const col = idx + 1;
  const values = sh.getRange(2, col, lastRow - 1, 1).getDisplayValues();

  let maior = 0;

  values.forEach(row => {
    const m = String(row[0] || "").trim().match(/^ID-(\d+)$/i);
    if (m) maior = Math.max(maior, Number(m[1]));
  });

  return "ID-" + String(maior + 1).padStart(3, "0");
}

function normalizarIDCadastro_(v) {
  return String(v || "").trim().toUpperCase();
}

function limparTelefoneTexto_(v) {
  return String(v || "").replace(/[^\d+]/g, "");
}

function normalizarCPF_(cpf) {
  if (cpf === null || cpf === undefined) return "";
  const apenasNumeros = String(cpf).replace(/\D/g, "");
  if (!apenasNumeros) return "";
  return apenasNumeros.padStart(11, "0").slice(-11);
}

function toNumberBR_(v) {
  if (v === null || v === undefined || v === "") return 0;

  const s = String(v)
    .trim()
    .replace(/[R$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

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

  const comInterrogacao = (semInterrogacao + "?").replace(/\s+/g, " ").trim();
  if (headerMap[comInterrogacao] !== undefined) return headerMap[comInterrogacao];

  return undefined;
}

function normHeader_(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\?/g, "")
    .replace(/\s+/g, " ");
}

/***************
 * CRM / Follow-up
 ***************/

function salvarOrcamentoCRM_(dados) {
  try {
    const ss = SpreadsheetApp.openById(BP_SPREADSHEET_ID);

    const agora = new Date();
    const proximo = new Date(agora);
    proximo.setDate(proximo.getDate() + 3);

    const id = dados.id || ("ORC" + Utilities.getUuid().slice(0, 8).toUpperCase());

    const registro = {
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
    };

    salvarLinhaPorCabecalho_(ss, "ORCAMENTOS_CRM", registro);

    salvarLinhaPorCabecalho_(ss, "FOLLOWUP", {
      Nome: registro.Nome,
      Telefone: registro.Telefone,
      "Dias sem Contato": 0,
      Status: registro.Status
    });

    return {
      ok: true,
      message: "OrÃ§amento salvo no CRM e FOLLOWUP âœ…"
    };

  } catch (e) {
    return {
      ok: false,
      message: "Erro ao salvar orÃ§amento CRM: " + (e && e.message ? e.message : e)
    };
  }
}

function salvarLinhaPorCabecalho_(ss, nomeAba, registro) {
  const sh = ss.getSheetByName(nomeAba);
  if (!sh) throw new Error('Aba "' + nomeAba + '" nÃ£o encontrada.');

  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const headerMap = buildHeaderMap_(headers);

  const lastRow = sh.getLastRow();
  sh.insertRowAfter(lastRow);

  const rowIndex = lastRow + 1;

  Object.keys(registro).forEach(function(campo) {
    const idx = findHeaderIndex_(headerMap, campo);

    if (idx !== undefined) {
      sh.getRange(rowIndex, idx + 1).setValue(registro[campo]);
    }
  });
}
