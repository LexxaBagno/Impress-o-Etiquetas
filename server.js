const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const pdfParse = require('pdf-parse');

let fetch = globalThis.fetch || require('node-fetch');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

const DIRETORIO_TEMP = path.join(__dirname, 'temp_github_modelos');
if (!fs.existsSync(DIRETORIO_TEMP)) {
    fs.mkdirSync(DIRETORIO_TEMP, { recursive: true });
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

        let codigosEncontrados = [];
        const regexGlobal = /\b(LX[0-9A-Z]+)\b/g;
        let match;

        while ((match = regexGlobal.exec(texto)) !== null) {
            let textoBruto = match[1];
            let codigoLimpo = textoBruto.replace(/(MONOCOMANDO|PORTA|PAPELEIRA|CHUVEIRO|HASTE|TTD|VALVULA|TORNEIRA|GRIF).*$/i, '').trim();

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
            return res.status(400).json({ erro: 'Nenhum código válido foi detetado no PDF.' });
        }

        // Fecha instâncias travadas do BarTender
        try {
            execSync('taskkill /f /im Bartend.exe', { stdio: 'ignore' });
        } catch (e) {}

        let totalEtiquetasImpressas = 0;

        for (const [codigo, qtd] of Object.entries(mapaItens)) {
            const urlGitHub = `https://raw.githubusercontent.com/LexxaBagno/Impress-o-Etiquetas/main/modelos/${codigo}.btw`;
            const caminhoLocalBtw = path.join(DIRETORIO_TEMP, `${codigo}.btw`);

            const resposta = await fetch(urlGitHub);
            if (!resposta.ok) {
                console.warn(`Modelo ${codigo}.btw não encontrado no GitHub.`);
                continue;
            }

            const bufferBtw = Buffer.from(await resposta.arrayBuffer());
            fs.writeFileSync(caminhoLocalBtw, bufferBtw);

            // Dispara o BarTender com o modelo baixado do GitHub e o parâmetro /C=qtd
            const comando = `cmd.exe /c ""C:\\Program Files\\Seagull\\BarTender 12.1\\BarTend.exe" /F="${caminhoLocalBtw}" /PRN="${impressora}" /C=${qtd} /P /X"`;
            execSync(comando);
            totalEtiquetasImpressas += qtd;
        }

        if (totalEtiquetasImpressas === 0) {
            return res.status(400).json({ erro: 'Nenhum modelo correspondente foi encontrado no GitHub.' });
        }

        res.json({ 
            sucesso: true, 
            mensagem: `PDF processado! ${totalEtiquetasImpressas} etiqueta(s) descarregadas do GitHub e impressas com sucesso.` 
        });

    } catch (error) {
        res.status(500).json({ erro: 'Erro interno ao processar o PDF: ' + error.message });
    }
});

app.listen(3000, () => {
    console.log('Servidor rodando em http://localhost:3000');
});
