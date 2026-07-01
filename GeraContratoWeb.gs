/***************
 * ContratoWeb.gs — BeloPet
 * Geração de contrato individual via clientes.html
 * Não altera a função gerarContratos() atual da planilha.
 ***************/

function gerarContratoClienteWeb_(idCadastro) {
  try {
    idCadastro = String(idCadastro || "").trim();

    if (!idCadastro) {
      return { ok: false, message: "IDCadastro não informado." };
    }

    const ss = SpreadsheetApp.openById(BP_SS_ID);
    const aba = ss.getSheetByName("DadosClientes");

    if (!aba) {
      return { ok: false, message: 'Aba "DadosClientes" não encontrada.' };
    }

    const range = aba.getDataRange();
    const dados = range.getValues();
    const dadosDisplay = range.getDisplayValues();

    if (!dados || dados.length < 2) {
      return { ok: false, message: "Não há clientes cadastrados." };
    }

    const cabecalhos = dados[0].map(h => String(h).trim());

    function idx(nome, obrigatorio) {
      const alvo = normalizarCabecalhoContratoWeb_(nome);
      const i = cabecalhos.findIndex(h => normalizarCabecalhoContratoWeb_(h) === alvo);

      if (i === -1 && obrigatorio !== false) {
        throw new Error('Cabeçalho não encontrado: "' + nome + '"');
      }

      return i;
    }

    const idxID = idx("IDCadastro", true);
    const idxNome = idx("Nome", false);
    const idxCPF = idx("CPF", false);
    const idxContratoGerado = idx("ContratoGerado", true);
    const idxLinkContrato = idx("Link Contrato", true);

    let linhaIndex = -1;

    for (let i = 1; i < dadosDisplay.length; i++) {
      const idLinha = String(dadosDisplay[i][idxID] || "").trim();

      if (idLinha.toUpperCase() === idCadastro.toUpperCase()) {
        linhaIndex = i;
        break;
      }
    }

    if (linhaIndex === -1) {
      return {
        ok: false,
        message: "Cliente não encontrado pelo IDCadastro: " + idCadastro
      };
    }

    const linhaPlanilha = linhaIndex + 1;
    const linha = dados[linhaIndex];
    const linhaDisplay = dadosDisplay[linhaIndex];

    const nomeCliente = idxNome >= 0 ? String(linhaDisplay[idxNome] || "").trim() : "";
    const cpfCliente = idxCPF >= 0 ? String(linhaDisplay[idxCPF] || "").trim() : "";

    if (!idCadastro && !nomeCliente) {
      return { ok: false, message: "Linha sem IDCadastro e sem nome. Contrato não gerado." };
    }

    const idTemplate = "1Vls-WIPUu-Fpi8U3fGdstBtr_RbtGGELHetlNc3Bs3g";
    const pastaDestinoId = "1Gj4no1L7dYIgZU-B0VB7XCsPIo144pPU";

    const modelo = DriveApp.getFileById(idTemplate);
    const pastaDestino = DriveApp.getFolderById(pastaDestinoId);

    const agora = new Date();
    const horaAtual = Utilities.formatDate(
      agora,
      Session.getScriptTimeZone(),
      "yyyyMMdd_HHmmss"
    );

    const nomeContrato =
      "ContratoBelopet_" +
      limparNomeArquivoContratoWeb_(idCadastro || nomeCliente || "cliente") +
      "_" +
      horaAtual;

    const copia = modelo.makeCopy(nomeContrato, pastaDestino);
    const contrato = DocumentApp.openById(copia.getId());
    const body = contrato.getBody();

    cabecalhos.forEach((campo, j) => {
      let valor = linha[j];
      let valorDisplay = linhaDisplay[j];

      if (
        normalizarCabecalhoContratoWeb_(campo) === "valor acordado" ||
        normalizarCabecalhoContratoWeb_(campo) === "sinal" ||
        normalizarCabecalhoContratoWeb_(campo) === "restante"
      ) {
        valor = formatarRealContratoWeb_(valorDisplay || valor);
      } else if (
        normalizarCabecalhoContratoWeb_(campo) === "pee" ||
        normalizarCabecalhoContratoWeb_(campo) === "ped"
      ) {
        valor = String(valorDisplay || valor).trim().toUpperCase() === "S" ? "Sim" : "Não";
      } else if (normalizarCabecalhoContratoWeb_(campo) === "cpf") {
        valor = formatarCPFContratoWeb_(valorDisplay || valor);
      } else if (valor instanceof Date) {
        valor = Utilities.formatDate(valor, Session.getScriptTimeZone(), "dd/MM/yyyy");
      } else if (valorDisplay !== undefined && valorDisplay !== null && valorDisplay !== "") {
        valor = valorDisplay;
      } else if (valor === undefined || valor === null) {
        valor = "";
      }

      body.replaceText(
        placeholderRegexContratoWeb_(campo),
        String(valor)
      );
    });

    const dataAtual = dataPorExtensoContratoWeb_();

    body.replaceText("\\{\\{\\s*dataAtual\\s*\\}\\}", dataAtual);
    body.replaceText("\\{\\{\\s*data_hoje\\s*\\}\\}", dataAtual);

    contrato.saveAndClose();

    const pdfBlob = DriveApp.getFileById(copia.getId())
      .getAs("application/pdf")
      .setName(nomeContrato + ".pdf");

    const arquivoPDF = pastaDestino.createFile(pdfBlob);
    arquivoPDF.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const urlContrato = arquivoPDF.getUrl();

    try {
      aba.getRange(linhaPlanilha, idxLinkContrato + 1)
        .setFormula('=HYPERLINK("' + urlContrato + '"; "📄 Ver contrato")');
    } catch (e) {
      aba.getRange(linhaPlanilha, idxLinkContrato + 1).setValue(urlContrato);
    }

    aba.getRange(linhaPlanilha, idxContratoGerado + 1).setValue("G");

    return {
      ok: true,
      idCadastro: idCadastro,
      nome: nomeCliente,
      cpf: cpfCliente,
      urlContrato: urlContrato,
      message: "Contrato gerado com sucesso."
    };

  } catch (err) {
    return {
      ok: false,
      message: "Erro ao gerar contrato: " + (err && err.message ? err.message : err)
    };
  }
}

function dataPorExtensoContratoWeb_() {
  const agora = new Date();
  const meses = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
  ];

  return agora.getDate() + " de " + meses[agora.getMonth()] + " de " + agora.getFullYear();
}

function formatarCPFContratoWeb_(cpf) {
  const limpo = String(cpf || "").replace(/\D/g, "");

  if (!limpo) return "";

  const cpf11 = limpo.padStart(11, "0").slice(-11);

  return cpf11.replace(
    /^(\d{3})(\d{3})(\d{3})(\d{2})$/,
    "$1.$2.$3-$4"
  );
}

function formatarRealContratoWeb_(valor) {
  if (valor === "" || valor === null || valor === undefined) return "";

  const n = Number(
    String(valor)
      .replace(/R\$|\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  );

  if (isNaN(n)) return String(valor || "");

  return "R$ " + n.toFixed(2).replace(".", ",");
}

function limparNomeArquivoContratoWeb_(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

function escapeRegexContratoWeb_(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function placeholderRegexContratoWeb_(campo) {
  return "\\{\\{\\s*" + escapeRegexContratoWeb_(campo) + "\\s*\\}\\}";
}

function normalizarCabecalhoContratoWeb_(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\?/g, "")
    .replace(/\s+/g, " ");
}
