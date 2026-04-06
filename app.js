require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');

const app = express();

/* =====================
   Middlewares essenciais
===================== */
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY não definida');
}

/* =====================
   Multer (memória)
===================== */
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 8 * 1024 * 1024 // 8MB por imagem
    }
});

/* =====================
   Healthcheck
===================== */
app.get('/', (req, res) => {
    res.json({ status: 'ok', env: process.env.VERCEL ? 'vercel' : 'local' });
});

/* =====================
   Gerar imagem combinada
===================== */
app.post('/generation-image', upload.array('image', 2), async (req, res) => {
    try {
        const { prompt, typeproduct } = req.body;

        if (!prompt || !typeproduct) {
            return res.status(400).json({
                error: 'prompt e typeproduct são obrigatórios'
            });
        }

        if (!req.files || req.files.length !== 2) {
            return res.status(400).json({
                error: 'Envie exatamente 2 imagens'
            });
        }

        const formData = new FormData();
        formData.append('model', 'gpt-image-1-mini');
        formData.append('quality', 'high');
        formData.append('prompt', prompt);
        formData.append('size', '1024x1536');
        formData.append('n', '1');
        formData.append('output_format', 'png');

        req.files.forEach((file) => {
            formData.append('image[]', file.buffer, {
                filename: file.originalname,
                contentType: file.mimetype
            });
        });

        const response = await axios.post(
            'https://api.openai.com/v1/images/edits',
            formData,
            {
                headers: {
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                    ...formData.getHeaders()
                },
                timeout: 60_000 // 🔥 evita crash da Vercel
            }
        );

        return res.json(response.data);

    } catch (err) {
        console.error('generation-image:', err.response?.data || err.message);
        return res.status(500).json({
            error: 'Erro ao gerar imagem',
            details: err.response?.data || err.message
        });
    }
});

/* =====================
   Ler imagem
===================== */
app.post('/read-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Envie uma imagem' });
        }

        const base64 = req.file.buffer.toString('base64');

        const payload = {
            model: 'gpt-4o-mini',
            temperature: 0,
            messages: [
                {
                    role: 'system',
                    content: 'extrai dados estruturados de imagens.'
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: `
                        Esta imagem pode estar girada. Leia o texto e os números mesmo que estejam inclinados. 
Gire mentalmente a imagem se necessário para que o texto fique horizontal. 
Extraia TODO texto e TODOS números, considerando que na imagem pode conter codigo sequencial alfanumerico e quantidade separado:
                                Leia a imagem e retorne APENAS JSON válido.
                                Formato obrigatório:
                                [
                                { "partnumber": string, "quantity": number }
                                ]

                                Regras:
                                - NÃO use markdown
                                - NÃO inclua texto explicativo
                                - se não houver quantity, usar 1
                                - Ignore qualquer texto que não seja produto
                                - pode ser que o partnumber tenha / e pode confundir com o numero 1
                                - Ignore qualquer caracter que não seja numeros, letras e - ou /
                                 - Ignore qualquer palavra, exemplo: "1 - sangria - 74RD7899E" deve ignorar 'sangria' pq é uma palavra, ou seja, se houver 3 letras consecutivas pode ignorar a palavra ficando quantidade 1 e partnumber 74RD7899E.
                                `
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/png;base64,${base64}`
                            }
                        }
                    ]
                }
            ]
        };

        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${OPENAI_API_KEY}`
                },
                timeout: 45_000
            }
        );

        const content = response.data?.choices?.[0]?.message?.content;

        if (!content) {
            return res.status(500).json({
                error: 'Resposta inválida da OpenAI',
                data: response.data
            });
        }

        return res.json({ result: content });

    } catch (err) {
        console.error('❌ read-image:', err.response?.data || err.message);
        return res.status(500).json({
            error: 'Erro ao ler imagem',
            details: err.response?.data || err.message
        });
    }
});

/* =====================
   Local apenas
===================== */
if (!process.env.VERCEL) {
    app.listen(8081, () => {
        console.log('Servidor local em http://localhost:8081');
    });
}

/* =====================
   EXPORT OBRIGATÓRIO
===================== */
module.exports = app;
