import express from 'express';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;


// CORS configuration
const corsOptions = {
    origin: process.env.NODE_ENV === 'production'
        ? 'https://bijoor.github.io/isometric-compiler-ui'
        : 'http://localhost:5173', // Assuming Vite's default port
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('public'));

// Shapes library
const shapesLibrary = new Map();

// Function to load shapes library
async function loadShapesLibrary(directoryPath) {
    const files = await fsPromises.readdir(directoryPath);
    
    for (const file of files) {
        if (path.extname(file) === '.csv') {
            await new Promise((resolve) => {
                fs.createReadStream(path.join(directoryPath, file))
                    .pipe(csv())
                    .on('data', (row) => {
                        shapesLibrary.set(row.name, {
                            svgFile: row.svgFile,
                            type: row.type,
                            attach: row.attach
                        });
                    })
                    .on('end', resolve);
            });
        }
    }
}

// Load shapes library on server start
await loadShapesLibrary('./shapes');

// API to get available shapes with SVG content
app.get('/shapes', async (req, res) => {
    const shapes = [];
    for (const [name, data] of shapesLibrary.entries()) {
        try {
            const svgContent = await fsPromises.readFile(path.join('./shapes', data.svgFile), 'utf8');
            shapes.push({
                name,
                type: data.type,
                attach: data.attach,
                svgContent
            });
        } catch (error) {
            console.error(`Error reading SVG file for shape ${name}:`, error);
        }
    }
    res.json(shapes);
});

// Serve the React app
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});