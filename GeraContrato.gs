/***************
 * GeraContrato.gs â€” BeloPet
 * GeraÃ§Ã£o de contratos a partir da aba DadosClientes
 * Usa IDCadastro no nome do arquivo e nÃ£o exige CPF para gerar.
 ***************/

function gerarContratos() {
  function dataPorExtenso() {
    const agora = new Date();
    const meses = [
      "janeiro", "fevereiro", "marÃ§o", "abril", "maio", "junho",
      "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
    ];
    return `${agora.getDate()} de ${meses[agora.getMonth()]} de ${agora.getFullYear()}`;
  }

  function formatarCPF(cpf) {
    const limpo = String(cpf || "").replace(/\D/g, "");
    if (!limpo) return "";
    const cpf11 = limpo.padStart(11, "0").slice(-11);
    return cpf11.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }

  function formatarReal(valor) {
    if (valor === "" || valor === null || valor === undefined) return "";
    const n = Number(String(valor).replace(/R\$|\s/g, "").replace(/\./g, "").replace(",", "."));
    if (isNaN(n)) return String(valor || "");
    return "R$ " + n.toFixed(2).replace(".", ",");
  }

  function escapeRegex(texto) {
    return String(texto).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function placeholderRegex(campo) {
    return "\\{\\{\\s*" + escapeRegex(campo) + "\\s*\\}\\}";
  }

  function limparNomeArquivo(s) {
    return String(s || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 80);
  }

  const dataAtual = dataPorExtenso();
  const agora = new Date();
  const horaAtual = Utilities.formatDate(agora, Session.getScriptTimeZone(), "yyyyMMdd_HHmmss");

  const idTemplate = "1Vls-WIPUu-Fpi8U3fGdstBtr_RbtGGELHetlNc3Bs3g";
  const pastaDestinoId = "1Gj4no1L7dYIgZU-B0VB7XCsPIo144pPU";

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName("DadosClientes");
  if (!aba) throw new Error('Aba "DadosClientes" nÃ£o encontrada.');

  const range = aba.getDataRange();
  const dados = range.getValues();
  const dadosDisplay = range.getDisplayValues();
  if (!dados || dados.length < 2) {
    ss.toast("Nada a processar.", "Gerar Contratos", 5);
    return;
  }

  const cabecalhos = dados[0].map(h => String(h).trim());

  function idx(nome, obrigatorio) {
    const alvo = normalizarCabecalhoContrato_(nome);
    const i = cabecalhos.findIndex(h => normalizarCabecalhoContrato_(h) === alvo);
    if (i === -1 && obrigatorio !== false) throw new Error(`CabeÃ§alho nÃ£o encontrado: "${nome}"`);
    return i;
  }

  const idxID = idx("IDCadastro", false);
  const idxCPF = idx("CPF", false);
  const idxNome = idx("Nome", false);
  const idxContratoGerado = idx("ContratoGerado", true);
  const idxLinkContrato = idx("Link Contrato", true);

  const modelo = DriveApp.getFileById(idTemplate);
  const pastaDestino = DriveApp.getFolderById(pastaDestinoId);

  let gerados = 0;
  let pulados = 0;
  let falhas = 0;

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    const linhaDisplay = dadosDisplay[i];
    const linhaPlanilha = i + 1;

    const statusContrato = String(linhaDisplay[idxContratoGerado] || "").trim().toUpperCase();
    const statusOkParaGerar = statusContrato === "" || statusContrato === "A";
    if (!statusOkParaGerar) {
      pulados++;
      continue;
    }

    const idCadastro = idxID >= 0 ? String(linhaDisplay[idxID] || "").trim() : "";
    const nomeCliente = idxNome >= 0 ? String(linhaDisplay[idxNome] || "").trim() : "";

    // Evita gerar contrato de linhas vazias.
    if (!idCadastro && !nomeCliente) {
      pulados++;
      continue;
    }

    try {
      const cpfDisplay = idxCPF >= 0 ? String(linhaDisplay[idxCPF] || "").trim() : "";
      const idOuLinha = idCadastro || ("LINHA-" + linhaPlanilha);
      const nomeContrato = `ContratoBelopet_${limparNomeArquivo(idOuLinha)}_${horaAtual}`;

      const copia = modelo.makeCopy(nomeContrato, pastaDestino);
      const contrato = DocumentApp.openById(copia.getId());
      const body = contrato.getBody();

      cabecalhos.forEach((campo, j) => {
        let valor = linha[j];
        let valorDisplay = linhaDisplay[j];

        if (campo === "Valor acordado" || campo === "Sinal" || campo === "Restante") {
          valor = formatarReal(valorDisplay || valor);
        } else if (campo === "PEE" || campo === "PEE?" || campo === "PED" || campo === "PED?") {
          valor = String(valorDisplay || valor).trim().toUpperCase() === "S" ? "Sim" : "NÃ£o";
        } else if (campo === "CPF") {
          valor = formatarCPF(valorDisplay || valor);
        } else if (valor instanceof Date) {
          valor = Utilities.formatDate(valor, Session.getScriptTimeZone(), "dd/MM/yyyy");
        } else if (valorDisplay !== undefined && valorDisplay !== null && valorDisplay !== "") {
          valor = valorDisplay;
        } else if (valor === undefined || valor === null) {
          valor = "";
        }

        body.replaceText(placeholderRegex(campo), String(valor));
      });

      body.replaceText("\\{\\{\\s*dataAtual\\s*\\}\\}", dataAtual);
      body.replaceText("\\{\\{\\s*data_hoje\\s*\\}\\}", dataAtual);

      contrato.saveAndClose();

      const pdfBlob = DriveApp.getFileById(copia.getId())
        .getAs("application/pdf")
        .setName(`${nomeContrato}.pdf`);

      const arquivoPDF = pastaDestino.createFile(pdfBlob);
      arquivoPDF.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      const urlContrato = arquivoPDF.getUrl();

      try {
        aba.getRange(linhaPlanilha, idxLinkContrato + 1)
          .setFormula(`=HYPERLINK("${urlContrato}"; "ðŸ“„ Ver contrato")`);
      } catch (e) {
        aba.getRange(linhaPlanilha, idxLinkContrato + 1).setValue(urlContrato);
      }

      aba.getRange(linhaPlanilha, idxContratoGerado + 1).setValue("G");
      gerados++;
    } catch (err) {
      falhas++;
      Logger.log(`Erro na linha ${linhaPlanilha}: ${err && err.message ? err.message : err}`);
    }
  }

  ss.toast(
    `Contratos gerados: ${gerados} | Pulados: ${pulados} | Falhas: ${falhas}`,
    "Gerar Contratos",
    8
  );
}

function normalizarCabecalhoContrato_(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\?/g, "")
    .replace(/\s+/g, " ");
}
