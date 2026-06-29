function gerarContratos() {
  function dataPorExtenso() {
    const agora = new Date();
    const meses = [
      "janeiro", "fevereiro", "março", "abril", "maio", "junho",
      "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
    ];
    return `${agora.getDate()} de ${meses[agora.getMonth()]} de ${agora.getFullYear()}`;
  }

  function formatarCPF(cpf) {
    const limpo = String(cpf || "").replace(/\D/g, "").padStart(11, "0").slice(-11);
    return limpo.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }

  function formatarReal(valor) {
    const n = Number(valor || 0);
    return "R$ " + n.toFixed(2).replace(".", ",");
  }

  function escapeRegex(texto) {
    return String(texto).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function placeholderRegex(campo) {
    return "\\{\\{\\s*" + escapeRegex(campo) + "\\s*\\}\\}";
  }

  const dataAtual = dataPorExtenso();
  const agora = new Date();
  const horaAtual = Utilities.formatDate(agora, Session.getScriptTimeZone(), "HHmmss");

  const idTemplate = "1Vls-WIPUu-Fpi8U3fGdstBtr_RbtGGELHetlNc3Bs3g";
  const pastaDestinoId = "1Gj4no1L7dYIgZU-B0VB7XCsPIo144pPU";

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName("DadosClientes");
  if (!aba) throw new Error('Aba "DadosClientes" não encontrada.');

  const dados = aba.getDataRange().getValues();
  if (!dados || dados.length < 2) {
    ss.toast("Nada a processar.", "Gerar Contratos", 5);
    return;
  }

  const cabecalhos = dados[0].map(h => String(h).trim());

  function idx(nome) {
    const i = cabecalhos.indexOf(nome);
    if (i === -1) throw new Error(`Cabeçalho não encontrado: "${nome}"`);
    return i;
  }

  const idxCPF = idx("CPF");
  const idxContratoGerado = idx("ContratoGerado");
  const idxLinkContrato = idx("Link Contrato");

  const modelo = DriveApp.getFileById(idTemplate);
  const pastaDestino = DriveApp.getFolderById(pastaDestinoId);

  let gerados = 0;
  let pulados = 0;
  let falhas = 0;

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    const linhaPlanilha = i + 1;

    const cpfRaw = String(linha[idxCPF] || "").replace(/\D/g, "");
    const statusContrato = String(linha[idxContratoGerado] || "").trim().toUpperCase();

    const statusOkParaGerar = statusContrato === "" || statusContrato === "A";

    if (!cpfRaw || cpfRaw.length > 11 || !statusOkParaGerar) {
      pulados++;
      continue;
    }

    const cpf11 = cpfRaw.padStart(11, "0");

    try {
      const nomeContrato = `ContratoBelopet_${cpf11}_${horaAtual}`;

      const copia = modelo.makeCopy(nomeContrato, pastaDestino);
      const contrato = DocumentApp.openById(copia.getId());
      const body = contrato.getBody();

      cabecalhos.forEach((campo, j) => {
        let valor = linha[j];

        if (campo === "Valor acordado" || campo === "Sinal" || campo === "Restante") {
          valor = formatarReal(valor);
        } else if (campo === "PEE" || campo === "PEE?" || campo === "PED" || campo === "PED?") {
          valor = String(valor).trim().toUpperCase() === "S" ? "Sim" : "Não";
        } else if (campo === "CPF") {
          valor = formatarCPF(cpf11);
        } else if (valor instanceof Date) {
          valor = Utilities.formatDate(valor, Session.getScriptTimeZone(), "dd/MM/yyyy");
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
          .setFormula(`=HYPERLINK("${urlContrato}"; "📄 Ver contrato")`);
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