/***************
 * Clientes.gs Ã¢â‚¬â€ BeloPet
 * DadosClientes + CRM + WebApp
 * Inclui novo cadastro e atualiza cadastro existente por linhaEdicao
 ***************/

const BP_SHEETS = {
  DADOS: "DadosClientes",
  PONTOS: "PontosEncontro",
};

const BP_SS_ID = "112Dm9XVjPwFFBkMLOC0_Q9lacmXJlAcQk3Cuh3nei64";

function BP_openDadosClientesSidebar() {
  const html = HtmlService.createHtmlOutputFromFile("Sidebar")
    .setTitle("Cadastro Ã¢â‚¬â€ DadosClientes");
  SpreadsheetApp.getUi().showSidebar(html);
}

function getFormMeta() {
  return {
    sentidos: ["SOBE", "DESCE", "SPSUL", "DF", "Ã¢â‚¬â€"],
    simNao: ["S", "N", "Ã¢â‚¬â€"],
  };
}

function getPontosEncontro() {
  const ss = SpreadsheetApp.openById(BP_SS_ID);
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
    const payload = JSON.parse(e.postData.contents || "{}");
    const acao = String(payload.acao || "").trim();

    if (acao === "buscar_dados_cliente") {
      return jsonOutput_(buscarDadosCliente_(payload));
    }

    // IMPORTANTE: atualizar precisa vir ANTES do salvar padrÃ£o.
    if (acao === "atualizar_dados_cliente") {
      return jsonOutput_(atualizarDadosCliente_(payload));
    }

    if (acao === "incluir_dados_cliente") {
      return jsonOutput_(salvarDados(payload));
    }

    const pareceCRM =
      acao === "orcamento_crm" ||
      payload.modalidade ||
      payload.valorCompartilhado ||
      payload.valorExclusivo ||
      payload.mensagemWhatsApp;

    if (pareceCRM) {
      return jsonOutput_(salvarOrcamentoCRM_(payload));
    }

    // Compatibilidade com formulÃƒÂ¡rios antigos sem acao.
    return jsonOutput_(salvarDados(payload));

  } catch (err) {
    return jsonOutput_({
      ok: false,
      message: "Erro no doPost: " + (err && err.message ? err.message : err)
    });
  }
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const acao = String(params.acao || "").trim();
    let resposta;

    if (acao === "buscar_dados_cliente") {
      resposta = buscarDadosCliente_({ termo: params.termo || "" });
    } else {
      resposta = { ok: false, message: "AÃ§Ã£o GET invÃ¡lida." };
    }

    if (params.callback) {
      return jsonpOutput_(params.callback, resposta);
    }
    return jsonOutput_(resposta);

  } catch (err) {
    const resposta = { ok: false, message: "Erro no doGet: " + (err && err.message ? err.message : err) };
    const params = (e && e.parameter) ? e.parameter : {};
    if (params.callback) return jsonpOutput_(params.callback, resposta);
    return jsonOutput_(resposta);
  }
}

function jsonpOutput_(callback, obj) {
  const safeCallback = String(callback || "callback").replace(/[^a-zA-Z0-9_$\.]/g, "");
  return ContentService
    .createTextOutput(safeCallback + "(" + JSON.stringify(obj) + ");")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function salvarDados(payload) {
  try {
    const ss = SpreadsheetApp.openById(BP_SS_ID);
    const sh = ss.getSheetByName(BP_SHEETS.DADOS);
    if (!sh) throw new Error('Aba "DadosClientes" nÃ£o encontrada.');

    const rowIndex = encontrarPrimeiraLinhaVaziaDadosClientes_(sh);

    escreverDadosClienteNaLinha_(sh, rowIndex, payload, { preservarContrato: false });

    return { ok: true, message: "Cadastro incluÃ­do âœ…", rowIndex: rowIndex };

  } catch (e) {
    return { ok: false, message: "Erro ao salvar: " + (e && e.message ? e.message : e) };
  }
}

function encontrarPrimeiraLinhaVaziaDadosClientes_(sh) {
  const startRow = 2;
  const lastRow = Math.max(sh.getLastRow(), startRow);
  const colNome = 5; // coluna E = Nome

  const valores = sh.getRange(startRow, colNome, lastRow - startRow + 1, 1).getValues();

  for (let i = 0; i < valores.length; i++) {
    if (!String(valores[i][0] || "").trim()) {
      return startRow + i;
    }
  }

  return lastRow + 1;
}


function buscarDadosCliente_(payload) {
  const termoOriginal = String(payload.termo || "").trim();
  const termo = normalizarBusca_(termoOriginal);
  const termoDigitos = somenteDigitos_(termoOriginal);

  if (!termoOriginal) {
    return { ok: false, message: "Termo de busca vazio.", resultados: [] };
  }

  const ss = SpreadsheetApp.openById(BP_SS_ID);
  const sh = ss.getSheetByName(BP_SHEETS.DADOS);
  if (!sh) throw new Error('Aba "DadosClientes" nÃ£o encontrada.');

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return { ok: true, resultados: [] };
  }

  // getDisplayValues() Ã© essencial: preserva CPF/telefone/valores como aparecem na tela,
  // inclusive zero Ã  esquerda e formataÃ§Ã£o com R$.
  const values = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const headers = values[0] || [];
  const headerMap = buildHeaderMap_(headers);

  function col(nome) {
    const idx = findHeaderIndex_(headerMap, nome);
    return idx === undefined ? -1 : idx;
  }

  function val(linha, idx) {
    return idx >= 0 ? String(linha[idx] || "").trim() : "";
  }

  const c = {
    dataViagem: col("Data Viagem"),
    dePara: col("DE/PARA"),
    sentido: col("Sentido"),
    nome: col("Nome"),
    endContratante: col("EndereÃ§o do contratante"),
    cpf: col("CPF"),
    telefone: col("Telefone"),
    email: col("Email"),
    dadosPet: col("Dados Pet"),
    qtdePets: col("Qtde Pets"),
    caixa: col("Caixa"),
    respEmbarque: col("ResponsÃ¡vel no Embarque"),
    telRespEmbarque: col("Telefone Resp Embarque"),
    pee: col("PEE?"),
    localEmbarque: col("Local de Embarque"),
    coleta: col("Coleta"),
    respDesembarque: col("ResponsÃ¡vel da Desembarque"),
    telRespDesembarque: col("Telefone Resp Desembarque"),
    ped: col("PED?"),
    localDesembarque: col("Local de Desembarque"),
    valorAcordado: col("Valor acordado"),
    sinal: col("Sinal"),
    valorPendente: col("Restante"),
    obs: col("Obs"),
    idCadastro: col("IDCadastro")
  };

  const resultados = [];

  for (let r = 1; r < values.length; r++) {
    const linha = values[r];

    const camposPrincipais = [
      val(linha, c.idCadastro), val(linha, c.nome), val(linha, c.telefone),
      val(linha, c.cpf), val(linha, c.dePara), val(linha, c.dadosPet)
    ];

    if (!camposPrincipais.join("").trim()) continue;

    const blocoTexto = normalizarBusca_(camposPrincipais.join(" "));
    const blocoDigitos = somenteDigitos_(camposPrincipais.join(" "));

    const achouTexto = termo && blocoTexto.includes(termo);
    const achouDigitos = termoDigitos.length >= 3 && blocoDigitos.includes(termoDigitos);

    if (achouTexto || achouDigitos) {
      resultados.push({
        linhaEdicao: r + 1,
        idCadastro: val(linha, c.idCadastro),
        dataViagem: val(linha, c.dataViagem),
        dePara: val(linha, c.dePara),
        sentido: val(linha, c.sentido),
        nome: val(linha, c.nome),
        endContratante: val(linha, c.endContratante),
        cpf: val(linha, c.cpf).replace(/^'/, ""),
        telefone: val(linha, c.telefone).replace(/^'/, ""),
        email: val(linha, c.email),
        dadosPet: val(linha, c.dadosPet),
        qtdePets: val(linha, c.qtdePets),
        caixa: val(linha, c.caixa),
        respEmbarque: val(linha, c.respEmbarque),
        telRespEmbarque: val(linha, c.telRespEmbarque).replace(/^'/, ""),
        pee: val(linha, c.pee),
        localEmbarque: val(linha, c.localEmbarque),
        coleta: val(linha, c.coleta),
        respDesembarque: val(linha, c.respDesembarque),
        telRespDesembarque: val(linha, c.telRespDesembarque).replace(/^'/, ""),
        ped: val(linha, c.ped),
        localDesembarque: val(linha, c.localDesembarque),
        valorAcordado: val(linha, c.valorAcordado),
        sinal: val(linha, c.sinal),
        valorPendente: val(linha, c.valorPendente),
        obs: val(linha, c.obs)
      });

      if (resultados.length >= 20) break;
    }
  }

  return { ok: true, resultados: resultados };
}

function atualizarDadosCliente_(payload) {
  try {
    const ss = SpreadsheetApp.openById(BP_SS_ID);
    const sh = ss.getSheetByName(BP_SHEETS.DADOS);
    if (!sh) throw new Error('Aba "DadosClientes" nÃƒÂ£o encontrada.');

    const rowIndex = Number(payload.linhaEdicao || payload.rowIndex || payload.linha);
    if (!rowIndex || rowIndex < 2) {
      throw new Error("Linha de ediÃƒÂ§ÃƒÂ£o invÃƒÂ¡lida. O clientes.html precisa enviar linhaEdicao.");
    }

    if (rowIndex > sh.getLastRow()) {
      throw new Error("Linha de ediÃƒÂ§ÃƒÂ£o nÃƒÂ£o existe mais na planilha: " + rowIndex);
    }

    escreverDadosClienteNaLinha_(sh, rowIndex, payload, { preservarContrato: true });

    return { ok: true, message: "Cadastro atualizado Ã¢Å“â€¦", rowIndex: rowIndex };

  } catch (e) {
    return { ok: false, message: "Erro ao atualizar: " + (e && e.message ? e.message : e) };
  }
}

function escreverDadosClienteNaLinha_(sh, rowIndex, payload, opcoes) {
  opcoes = opcoes || {};

  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (!headers || headers.length === 0) {
    throw new Error("CabeÃƒÂ§alho da aba DadosClientes estÃƒÂ¡ vazio.");
  }

  const headerMap = buildHeaderMap_(headers);
  const SKIP_COLS = new Set([26]); // mantÃƒÂ©m sua regra original: nÃƒÂ£o escreve na coluna Z

  function setByHeader(headerName, value) {
    const idx = findHeaderIndex_(headerMap, headerName);
    if (idx === undefined) return;

    const col = idx + 1;
    if (SKIP_COLS.has(col)) return;

    sh.getRange(rowIndex, col).setValue(value ?? "");
  }

  function getByHeader(headerName) {
    const idx = findHeaderIndex_(headerMap, headerName);
    if (idx === undefined) return "";
    return sh.getRange(rowIndex, idx + 1).getValue();
  }

  const cpfFormatado = normalizarCPF_(payload.cpf);
  const valorAcordado = toNumberBR_(payload.valorAcordado);
  const sinal = toNumberBR_(payload.sinal);

  let restante = valorAcordado - sinal;
  if (!isFinite(restante)) restante = 0;
  restante = Math.round(restante);

  setByHeader("Data Viagem", payload.dataViagem);
  setByHeader("DE/PARA", payload.dePara);
  setByHeader("Sentido", payload.sentido);

  setByHeader("Nome", payload.nome);
  setByHeader("EndereÃƒÂ§o do contratante", payload.endContratante);
  setByHeader("CPF", cpfFormatado ? "'" + cpfFormatado : "");
  setByHeader("Telefone", payload.telefone);
  setByHeader("Email", payload.email);

  setByHeader("Dados Pet", payload.dadosPet);
  setByHeader("Qtde Pets", payload.qtdePets);
  setByHeader("Caixa", payload.caixa);

  setByHeader("ResponsÃƒÂ¡vel no Embarque", payload.respEmbarque);
  setByHeader("Telefone Resp Embarque", payload.telRespEmbarque);
  setByHeader("PEE?", payload.pee);
  setByHeader("Local de Embarque", payload.localEmbarque);
  setByHeader("Coleta", payload.coleta);

  setByHeader("ResponsÃƒÂ¡vel da Desembarque", payload.respDesembarque);
  setByHeader("Telefone Resp Desembarque", payload.telRespDesembarque);
  setByHeader("PED?", payload.ped);
  setByHeader("Local de Desembarque", payload.localDesembarque);

  setByHeader("Valor acordado", valorAcordado);
  setByHeader("Sinal", sinal);
  setByHeader("Restante", restante);

  setByHeader("Obs", payload.obs);

  // Em atualizaÃƒÂ§ÃƒÂ£o, nÃƒÂ£o apaga contrato/link/status jÃƒÂ¡ existentes se o payload vier vazio.
  const preservar = !!opcoes.preservarContrato;

  const linkContrato = preservar && !payload.linkContrato
    ? getByHeader("Link Contrato")
    : payload.linkContrato;

  const enviado = preservar && !payload.enviado
    ? getByHeader("Enviado?")
    : payload.enviado;

  const contratoGerado = preservar && !payload.contratoGerado
    ? getByHeader("ContratoGerado")
    : payload.contratoGerado;

  const falta = preservar && !payload.falta
    ? getByHeader("falta")
    : payload.falta;

  setByHeader("Link Contrato", linkContrato);
  setByHeader("Enviado?", enviado);
  setByHeader("ContratoGerado", contratoGerado);
  setByHeader("falta", falta);
}

/***************
 * CRM
 ***************/
function salvarOrcamentoCRM_(dados) {
  try {
    const ss = SpreadsheetApp.openById(BP_SS_ID);

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

    return { ok: true, message: "OrÃƒÂ§amento salvo no CRM e FOLLOWUP Ã¢Å“â€¦" };

  } catch (e) {
    return { ok: false, message: "Erro ao salvar orÃƒÂ§amento CRM: " + (e && e.message ? e.message : e) };
  }
}

function salvarLinhaPorCabecalho_(ss, nomeAba, registro) {
  const sh = ss.getSheetByName(nomeAba);
  if (!sh) throw new Error('Aba "' + nomeAba + '" nÃƒÂ£o encontrada.');

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

/***************
 * Helpers
 ***************/

function normalizarBusca_(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s@.+/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function somenteDigitos_(v) {
  return String(v || "").replace(/\D/g, "");
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
    .replace(/\s+/g, " ");
}
