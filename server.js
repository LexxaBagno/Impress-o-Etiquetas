const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const pdfParse = require('pdf-parse');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

const DIRETORIO_PROJETO = __dirname;
const DIRETORIO_MODELOS = path.join(DIRETORIO_PROJETO, 'modelos');

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

        // Regex global para capturar qualquer referência que comece com LX seguida de letras/números
        const regexGlobal = /\b(LX[0-9A-Z]+)\b/g;
        let match;

        while ((match = regexGlobal.exec(texto)) !== null) {
            let textoBruto = match[1];

            // Remove descrições compridas que venham coladas (ex: MONOCOMANDO, PORTA, PAPELEIRA, CHUVEIRO, HASTE, etc.)
            let codigoLimpo = textoBruto.replace(/(MONOCOMANDO|PORTA|PAPELEIRA|CHUVEIRO|HASTE|TTD|VALVULA|TORNEIRA|GRIF).*$/i, '');
            codigoLimpo = codigoLimpo.trim();

            // Ignora o código fantasma antigo e garante um tamanho mínimo válido
            if (codigoLimpo !== 'LX42114' && codigoLimpo.length >= 5) {
                codigosEncontrados.push(codigoLimpo);
            }
        }

        // Agrupa e conta quantas vezes cada código aparece no pedido para definir as cópias exatas
        let mapaItens = {};
        for (let codigo of codigosEncontrados) {
            let arquivoBtwPath = path.join(DIRETORIO_MODELOS, `${codigo}.btw`);
            
            // Tenta variações de letras O e zeros caso o ficheiro use nomenclatura diferente
            if (!fs.existsSync(arquivoBtwPath)) {
                let altCodigo = codigo.replace(/O/g, '0');
                let altPath = path.join(DIRETORIO_MODELOS, `${altCodigo}.btw`);
                if (fs.existsSync(altPath)) {
                    codigo = altCodigo;
                    arquivoBtwPath = altPath;
                }
            }

            // Considera apenas se o ficheiro .btw existir fisicamente na pasta
            if (fs.existsSync(arquivoBtwPath)) {
                mapaItens[codigo] = (mapaItens[codigo] || 0) + 1;
            } else {
                console.log(`Aviso: O código "${codigo}" foi encontrado no PDF, mas não tem modelo .btw correspondente (ignorado).`);
            }
        }

        console.log('Itens válidos e agrupados para impressão:', mapaItens);

        if (Object.keys(mapaItens).length === 0) {
            return res.status(400).json({ 
                erro: 'Nenhum dos produtos detetados neste PDF possui um ficheiro .btw correspondente na pasta "modelos".' 
            });
        }

        // Fecha instâncias anteriores travadas do BarTender na memória
        try {
            execSync('taskkill /f /im Bartend.exe', { stdio: 'ignore' });
        } catch (e) {}

        let totalEtiquetasImpressas = 0;

        // Dispara o BarTender agrupando por produto com o parâmetro de cópias /C=qtd para preencher as colunas
        for (const [codigo, qtd] of Object.entries(mapaItens)) {
            const arquivoBtwPath = path.join(DIRETORIO_MODELOS, `${codigo}.btw`);

            // O parâmetro /C=qtd diz ao BarTender para imprimir todas as cópias deste modelo no mesmo trabalho,
            // respeitando a configuração de 2 colunas do layout.
            const comando = `cmd.exe /c ""C:\\Program Files\\Seagull\\BarTender 12.1\\BarTend.exe" /F="${arquivoBtwPath}" /PRN="${impressora}" /C=${qtd} /P /X"`;
            console.log(`Enviando lote: ${codigo}.btw com ${qtd} cópia(s)`);
            execSync(comando);
            totalEtiquetasImpressas += qtd;
        }

        res.json({ 
            sucesso: true, 
            mensagem: `PDF processado com sucesso! ${totalEtiquetasImpressas} etiqueta(s) enviada(s) para a impressora.` 
        });

    } catch (error) {
        console.error('Erro detalhado no servidor:', error);
        res.status(500).json({ erro: 'Erro interno ao processar o PDF: ' + error.message });
    }
});

app.listen(3000, () => {
    console.log('Servidor a rodar em http://localhost:3000');
});