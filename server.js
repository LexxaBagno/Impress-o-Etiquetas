const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const pdfParse = require('pdf-parse');

// Suporte para fetch em versões mais antigas do Node.js
let fetch;
if (typeof globalThis.fetch === 'function') {
    fetch = globalThis.fetch;
} else {
    fetch = require('node-fetch');
}

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

const DIRETORIO_PROJETO = __dirname;
const DIRETORIO_MODELOS_LOCAL = path.join(DIRETORIO_PROJETO, 'modelos');
const DIRETORIO_TEMP_GITHUB = path.join(DIRETORIO_PROJETO, 'temp_github_modelos');

// Cria as pastas necessárias caso não existam
if (!fs.existsSync(DIRETORIO_MODELOS_LOCAL)) {
    fs.mkdirSync(DIRETORIO_MODELOS_LOCAL, { recursive: true });
}
if (!fs.existsSync(DIRETORIO_TEMP_GITHUB)) {
    fs.mkdirSync(DIRETORIO_TEMP_GITHUB, { recursive: true });
}

// Função para buscar o modelo no GitHub ou no fallback local
async function obterCaminhoModeloBtw(codigo) {
    const nomeArquivo = `${codigo}.btw`;
    const caminhoTemp = path.join(DIRETORIO_TEMP_GITHUB, nomeArquivo);
    const caminhoLocal = path.join(DIRETORIO_MODELOS_LOCAL, nomeArquivo);

    // 1. Tenta baixar do GitHub em tempo de execução
    const urlGitHub = `https://raw.githubusercontent.com/LexxaBagno/Impress-o-Etiquetas/main/modelos/${nomeArquivo}`;
    try {
        console.log(`[GitHub] Buscando modelo online: ${urlGitHub}`);
        const res = await fetch(urlGitHub);
        if (res.ok) {
            const arrayBuffer = await res.arrayBuffer();
            fs.writeFileSync(caminhoTemp, Buffer.from(arrayBuffer));
            console.log(`[GitHub] Modelo "${nomeArquivo}" baixado do GitHub com sucesso!`);
            return caminhoTemp;
        } else {
            console.warn(`[GitHub] Modelo "${nomeArquivo}" não encontrado no GitHub (HTTP ${res.status}).`);
        }
    } catch (err) {
        console.error(`[GitHub] Falha ao tentar conectar ao GitHub para ${nomeArquivo}:`, err.message);
    }

    // 2. Fallback: verifica se existe na pasta local 'modelos'
    if (fs.existsSync(caminhoLocal)) {
        console.log(`[Local] Usando modelo da pasta local: ${caminhoLocal}`);
        return caminhoLocal;
    }

    // 3. Tenta variação de letras O / zeros localmente
    const altCodigo = codigo.replace(/O/g, '0');
    const altCaminhoLocal = path.join(DIRETORIO_MODELOS_LOCAL, `${altCodigo}.btw`);
    if (fs.existsSync(altCaminhoLocal)) {
        console.log(`[Local] Usando modelo alternativo local: ${altCaminhoLocal}`);
        return altCaminhoLocal;
    }

    return null;
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

        // Agrupa as quantidades de cada código
        let mapaItens = {};
        for (let codigo of codigosEncontrados) {
            mapaItens[codigo] = (mapaItens[codigo] || 0) + 1;
        }

        console.log('Itens detectados no PDF:', mapaItens);

        if (Object.keys(mapaItens).length === 0) {
            return res.status(400).json({ 
                erro: 'Nenhum código LX válido foi localizado neste PDF.' 
            });
        }

        // Encerra processos pendentes do BarTender na memória
        try {
            execSync('taskkill /f /im Bartend.exe', { stdio: 'ignore' });
        } catch (e) {}

        let totalEtiquetasImpressas = 0;
        let errosModelos = [];

        for (const [codigo, qtd] of Object.entries(mapaItens)) {
            // Busca o arquivo .btw (GitHub -> Local)
            const caminhoBtw = await obterCaminhoModeloBtw(codigo);

            if (caminhoBtw) {
                // Comando do BarTender com lote /C=qtd para intercalar colunas corretamente
                const comando = `cmd.exe /c ""C:\\Program Files\\Seagull\\BarTender 12.1\\BarTend.exe" /F="${caminhoBtw}" /PRN="${impressora}" /C=${qtd} /P /X"`;
                console.log(`[Impressão] Disparando: ${codigo} (${qtd} cópia(s))`);
                execSync(comando);
                totalEtiquetasImpressas += qtd;
            } else {
                errosModelos.push(codigo);
                console.warn(`[Aviso] O modelo para "${codigo}" não foi encontrado no GitHub nem na pasta local.`);
            }
        }

        if (totalEtiquetasImpressas === 0) {
            return res.status(400).json({ 
                erro: `Nenhum dos modelos (${errosModelos.join(', ')}) foi localizado no GitHub ou na pasta local.` 
            });
        }

        let msgFinal = `PDF processado com sucesso! ${totalEtiquetasImpressas} etiqueta(s) enviada(s) para a impressora.`;
        if (errosModelos.length > 0) {
            msgFinal += ` (Modelos não encontrados: ${errosModelos.join(', ')})`;
        }

        res.json({ sucesso: true, mensagem: msgFinal });

    } catch (error) {
        console.error('Erro detalhado no servidor:', error);
        res.status(500).json({ erro: 'Erro interno ao processar o PDF: ' + error.message });
    }
});

app.listen(3000, () => {
    console.log('Servidor rodando em http://localhost:3000');
});
