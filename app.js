import express from 'express';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import cors from 'cors';  // Import the cors package

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// CORS configuration
const corsOptions = {
    origin: '*',  // This allows all origins
    methods: ['GET', 'POST'],  // Allow both GET and POST requests
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));  // Use the CORS middleware with our configuration

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
                            face: row.face
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
                face: data.face,
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

app.listen(port, () => {
    console.log(`SVG Isometric Shapes Compiler server listening at http://localhost:${port}`);
});