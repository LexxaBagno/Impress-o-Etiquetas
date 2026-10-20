const express = require('express');
const fs = require('fs');
const path = path = require('path');
const { execSync } = require('child_process');
const pdfParse = require('pdf-parse');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

const DIRETORIO_PROJETO = __dirname;
const DIRETORIO_TEMPORARIO = path.join(DIRETORIO_PROJETO, 'temp_modelos');

// Garante que a pasta temporária de modelos existe
if (!fs.existsSync(DIRETORIO_TEMPORARIO)) {
    fs.mkdirSync(DIRETORIO_TEMPORARIO, { recursive: true });
}

app.post('/api/imprimir-pdf', async (req, res) => {
    try {
        const { pdfBase64, impressora } = req.body;
        if (!pdfBase64) return res.status(400).json({ erro: 'Nenhum PDF enviado.' });
        if (!impressora) return res.status(400).json({ erro: 'Nenhuma impressora selecionada.' });

        const base64Data = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
        const bufferPdf = Buffer.from(base64Data, 'base64');

        const pdfData = await pdfParse(bufferPdf);
        const texto = pdfData.text;

        console.log("=== TEXTO EXTRAÍDO DO PDF ===");
        console.log(texto);
        console.log("=============================");

        let codigosEncontrados = [];
        const regexGlobal = /\b(LX[0-9A-Z]+)\b/g;
        let match;

        while ((match = regexGlobal.exec(texto)) !== null) {
            let textoBruto = match[1];
            let codigoLimpo = textoBruto.replace(/(MONOCOMANDO|PORTA|PAPELEIRA|CHUVEIRO|HASTE|TTD|VALVULA|TORNEIRA|GRIF).*$/i, '');
            codigoLimpo = codigoLimpo.trim();

            if (codigoLimpo !== 'LX42114' && codigoLimpo.length >= 5) {
                codigosEncontrados.push(codigoLimpo);
            }
        }

        // Agrupa as quantidades por código detetado
        let mapaItens = {};
        for (let codigo of codigosEncontrados) {
            mapaItens[codigo] = (mapaItens[codigo] || 0) + 1;
        }

        if (Object.keys(mapaItens).length === 0) {
            return res.status(400).json({ 
                erro: 'Nenhum código válido foi detetado no PDF.' 
            });
        }

        // Fecha instâncias anteriores travadas do BarTender na memória
        try {
            execSync('taskkill /f /im Bartend.exe', { stdio: 'ignore' });
        } catch (e) {}

        let totalEtiquetasImpressas = 0;

        for (const [codigo, qtd] of Object.entries(mapaItens)) {
            // URL Raw do ficheiro .btw no vosso GitHub (Branch: main)
            // Certifique-se de que o repositório é público ou ajuste para usar token se for privado
            const urlGitHubBtw = `https://raw.githubusercontent.com/LexxaBagno/Impress-o-Etiquetas/main/modelos/${codigo}.btw`;
            const caminhoLocalBtw = path.join(DIRETORIO_TEMPORARIO, `${codigo}.btw`);

            console.log(`A descarregar modelo do GitHub: ${urlGitHubBtw}`);

            try {
                // Faz o download direto do raw do GitHub usando fetch nativo do Node.js
                const respostaGitHub = await fetch(urlGitHubBtw);
                
                if (!respostaGitHub.ok) {
                    console.warn(`Aviso: O modelo "${codigo}.btw" não foi encontrado no GitHub (Status: ${respostaGitHub.status}).`);
                    continue; // Ignora e passa para o próximo se não existir no GitHub
                }

                const bufferBtw = Buffer.from(await respostaGitHub.arrayBuffer());
                fs.writeFileSync(caminhoLocalBtw, bufferBtw);

                // Dispara o BarTender com o ficheiro descarregado e o parâmetro de cópias /C=qtd
                const comando = `cmd.exe /c ""C:\\Program Files\\Seagull\\BarTender 12.1\\BarTend.exe" /F="${caminhoLocalBtw}" /PRN="${impressora}" /C=${qtd} /P /X"`;
                console.log(`Imprimindo ${codigo}.btw com ${qtd} cópia(s)`);
                execSync(comando);
                totalEtiquetasImpressas += qtd;

            } catch (errErroDownload) {
                console.error(`Erro ao obter ou imprimir o modelo ${codigo} do GitHub:`, errErroDownload.message);
            }
        }

        if (totalEtiquetasImpressas === 0) {
            return res.status(400).json({ 
                erro: 'Nenhum modelo correspondente foi encontrado ou descarregado com sucesso a partir do GitHub.' 
            });
        }

        res.json({ 
            sucesso: true, 
            mensagem: `PDF processado! ${totalEtiquetasImpressas} etiqueta(s) descarregadas do GitHub e impressas com sucesso.` 
        });

    } catch (error) {
        console.error('Erro detalhado no servidor:', error);
        res.status(500).json({ erro: 'Erro interno ao processar o PDF: ' + error.message });
    }
});

app.listen(3000, () => {
    console.log('Servidor a rodar em http://localhost:3000');
});
