import express from 'express';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import csv from 'csv-parser';
import SvgPath from 'svgpath';
import { SVGPathData } from 'svg-pathdata';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

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

function parseViewBox(viewBox) {
    const [minX, minY, width, height] = viewBox.split(/\s+/).map(parseFloat);
    return { minX, minY, width, height };
}


function calculateBoundingBox(element) {
    const bbox = {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity
    };
    console.log('\nBBox for '+element.id);

    function updateBBox(x, y) {
        bbox.minX = Math.min(bbox.minX, x);
        bbox.minY = Math.min(bbox.minY, y);
        bbox.maxX = Math.max(bbox.maxX, x);
        bbox.maxY = Math.max(bbox.maxY, y);
        console.log(' vertex:' + x + ',' + y);
    }

    function bezierExtrema(p0, p1, p2, p3) {
        // Calculate extrema for a cubic Bézier curve
        // This is a simplified approach and may not catch all extrema
        const tValues = [];
        for (let i = 0; i <= 1; i += 0.5) {
            tValues.push(i);
        }
        return tValues.map(t => {
            const mt = 1 - t;
            return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
        });
    }

    function processPath(pathElement) {
        const pathData = new SVGPathData(pathElement.getAttribute('d'));
        let currentX = 0, currentY = 0;
        
        pathData.commands.forEach(cmd => {
            let cmdType=cmd.type;
            console.log(` cmd ${cmdType}: ${cmd.x} ${cmd.y}`);
            switch (cmd.type) {
                case SVGPathData.MOVE_TO:
                case SVGPathData.LINE_TO:
                    currentX = cmd.x;
                    currentY = cmd.y;
                    updateBBox(currentX, currentY);
                    cmdType='M/L';
                    break;
                case SVGPathData.HORIZ_LINE_TO:
                    currentX = cmd.x;
                    updateBBox(currentX, currentY);
                    cmdType='H';
                    break;
                case SVGPathData.VERT_LINE_TO:
                    currentY = cmd.y;
                    updateBBox(currentX, currentY);
                    cmdType='V';
                    break;
                case SVGPathData.CURVE_TO:
                    const xExtrema = bezierExtrema(currentX, cmd.x1, cmd.x2, cmd.x);
                    const yExtrema = bezierExtrema(currentY, cmd.y1, cmd.y2, cmd.y);
                    xExtrema.forEach(x => updateBBox(x, currentY));
                    yExtrema.forEach(y => updateBBox(currentX, y));
                    currentX += cmd.x;
                    currentY += cmd.y;
                    updateBBox(currentX, currentY);
                    break;
                  case SVGPathData.SMOOTH_CURVE_TO:
                    //updateBBox(cmd.x2, cmd.y2);
                    currentX += cmd.x;
                    currentY += cmd.y;
                    //updateBBox(currentX, currentY);
                    cmdType='SC';
                    break;
                case SVGPathData.QUAD_TO:
                    //updateBBox(cmd.x1, cmd.y1);
                    currentX = cmd.x;
                    currentY = cmd.y;
                    updateBBox(currentX, currentY);
                    cmdType='Q';
                    break;
                case SVGPathData.SMOOTH_QUAD_TO:
                    currentX = cmd.x;
                    currentY = cmd.y;
                    updateBBox(currentX, currentY);
                    cmdType='SQ';
                    break;
                case SVGPathData.ARC:
                    // For simplicity, we're just considering the end point of the arc
                    currentX = cmd.x;
                    currentY = cmd.y;
                    updateBBox(currentX, currentY);
                    cmdType='A';
                    break;
                // CLOSE_PATH doesn't affect the bounding box
            }
            console.log(` cmd ${cmdType}: ${cmd.x} ${cmd.y}`);
        });
    }

    function processRect(rectElement) {
        const x = parseFloat(rectElement.getAttribute('x') || 0);
        const y = parseFloat(rectElement.getAttribute('y') || 0);
        const width = parseFloat(rectElement.getAttribute('width') || 0);
        const height = parseFloat(rectElement.getAttribute('height') || 0);
        
        updateBBox(x, y);
        updateBBox(x + width, y + height);
    }

    function processElement(el) {
        if (el.tagName.toLowerCase() === 'path') {
            processPath(el);
        } else if (el.tagName.toLowerCase() === 'rect') {
            processRect(el);
        } else if (el.tagName.toLowerCase() === 'g' || el.tagName.toLowerCase() === 'svg') {
            Array.from(el.children).forEach(processElement);
        }
    }

    processElement(element);

    if (bbox.minX === Infinity) {
        return null;
    }

    return {
        x: bbox.minX,
        y: bbox.minY,
        width: bbox.maxX - bbox.minX,
        height: bbox.maxY - bbox.minY
    };
}

export { calculateBoundingBox };

function drawBoundingBox(document, bbox, color) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', bbox.x);
    rect.setAttribute('y', bbox.y);
    rect.setAttribute('width', bbox.width);
    rect.setAttribute('height', bbox.height);
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', color);
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('vector-effect', 'non-scaling-stroke');
    return rect;
}

function positionShapeOn3DFace(shape2D, face3D, document, shape3DElement) {
    //console.log(`BBox for face ${face3D.id}`);
    const faceBBox = calculateBoundingBox(face3D);
    //console.log(`BBox for shape ${shape2D.id}`);
    const shapeBBox = calculateBoundingBox(shape2D);

    if (!faceBBox || !shapeBBox) {
        console.warn('Unable to calculate bounding box for face or shape');
        return null;
    }
    //console.log(`Face (${face3D.id}) structure :`, face3D.outerHTML);
    console.log(`Face (${face3D.id}) bounding box:`, faceBBox);
    console.log('Shape bounding box:', shapeBBox);

    // Calculate scaling to fit the shape within the face
    const scaleX = faceBBox.width / shapeBBox.width;
    const scaleY = faceBBox.height / shapeBBox.height;
    const scale = Math.min(scaleX, scaleY); 

    // Calculate translation
    const dx = faceBBox.x + (faceBBox.width - shapeBBox.width * scale) / 2;
    const dy = faceBBox.y + (faceBBox.height - shapeBBox.height * scale) / 2;
    shapeBBox.x += dx;
    shapeBBox.y += dy;

    const transform = `translate(${dx}, ${dy})`;
    console.log(`Calculated transform: ${transform}`);

    // Draw bounding boxes for debugging
    const faceBBoxRect = drawBoundingBox(document, faceBBox, 'red');
    const shapeBBoxRect = drawBoundingBox(document, shapeBBox, 'blue');
    shape3DElement.appendChild(faceBBoxRect);
    shape3DElement.appendChild(shapeBBoxRect);

    return transform;
}

function createSVGElement(svgString) {
    const dom = new JSDOM(svgString, { contentType: 'image/svg+xml' });
    return dom.window.document.querySelector('svg');
}

function extractShapesFromSVG(svgElement) {
    const shapes = [];
    const validShapeTags = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'];
    
    function extractFromElement(element) {
        if (validShapeTags.includes(element.tagName.toLowerCase())) {
            shapes.push(element.cloneNode(true));
        } else if (element.tagName.toLowerCase() === 'g') {
            // Extract the transform from the group, if any
            const groupTransform = element.getAttribute('transform');
            Array.from(element.children).forEach(child => {
                const clone = child.cloneNode(true);
                if (groupTransform) {
                    const childTransform = clone.getAttribute('transform') || '';
                    clone.setAttribute('transform', `${groupTransform} ${childTransform}`.trim());
                }
                shapes.push(clone);
            });
        }
    }
    
    Array.from(svgElement.children).forEach(extractFromElement);
    return shapes;
}


// API to compose diagram
app.post('/compose', async (req, res) => {
    const { objects, debug } = req.body;
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    const document = dom.window.document;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', '1000');
    svg.setAttribute('height', '1000');
    svg.setAttribute('viewBox', '0 0 1000 1000');

    // function to add a 2D shape to a 3D shape
    function add2DShapeTo3DShape(shape3DElement,shape2DElement,transform) {
        // Extract shapes from the 2D SVG
        const extractedShapes = extractShapesFromSVG(shape2DElement);

        // Create a group for the 2D shapes
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        // Apply transformation if provided
        if (transform) {
            group.setAttribute('transform', transform);
        }    
        // Append extracted shapes to the group
        extractedShapes.forEach(shape => {
            // Ensure the shape has a unique ID
            if (!shape.id) {
                shape.id = `shape-${Math.random().toString(36).substr(2, 9)}`;
            }
            group.appendChild(shape);
        });
        
        // Append the group directly to the shape3DElement, not to the face
        shape3DElement.appendChild(group);
    }
    
    try {
        for (const [index, obj] of objects.entries()) {
            const shape3D = shapesLibrary.get(obj.shape);
            if (!shape3D) {
                throw new Error(`Shape ${obj.shape} not found in library`);
            }
            
            const shape3DSVG = await fsPromises.readFile(path.join('./shapes', shape3D.svgFile), 'utf8');
            const shape3DElement = createSVGElement(shape3DSVG);
            
            if (!shape3DElement) {
                throw new Error(`Failed to extract SVG content for shape ${obj.shape}`);
            }

            //console.log(`3D shape structure for ${obj.shape}:`, shape3DElement.outerHTML);

            // Set a unique id for this instance of the shape
            shape3DElement.id = obj.name || `shape_${index}`;
            
            // Position the shape in the center of the drawing area
            const bbox = calculateBoundingBox(shape3DElement);
            if (bbox) {
                const centerX = 500 - bbox.width / 2;
                const centerY = 500 - bbox.height / 2;
                shape3DElement.setAttribute('transform', `translate(${centerX}, ${centerY}) scale(3)`);
            } else {
                console.warn(`Unable to calculate bounding box for 3D shape ${obj.shape}. Using default positioning.`);
                shape3DElement.setAttribute('transform', 'translate(500, 500) scale(3)');
            }
            
            // Attach 2D shapes
            for (const face of ['top', 'front', 'side']) {
                const faceElement = shape3DElement.querySelector(`#${face}-face`);
                if (faceElement && obj[face]) {
                    try {
                        for (const shape2DName of obj[face]) {
                            const shape2D = shapesLibrary.get(shape2DName);
                            if (shape2D) {
                                const shape2DSVG = await fsPromises.readFile(path.join('./shapes', shape2D.svgFile), 'utf8');
                                const shape2DElement = createSVGElement(shape2DSVG);
                                if (shape2DElement) {
                                    //console.log(`2D shape structure for ${shape2DName}:`, shape2DElement.outerHTML);
                                    const transform = positionShapeOn3DFace(shape2DElement, faceElement, document, shape3DElement);
                                    if (transform) {
                                        add2DShapeTo3DShape(shape3DElement, shape2DElement, transform);
                                    } else {
                                        console.warn(`Unable to position 2D shape ${shape2DName} on ${face} face.`);
                                    }
                                } else {
                                    console.warn(`Failed to extract SVG content for 2D shape ${shape2DName}`);
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Error composing diagram:', error);
                        res.status(500).json({ error: error.message });
                    }
                }
            }
            
            // Append the 3D shape (which now includes the 2D shapes) to the main SVG
            svg.appendChild(shape3DElement);
        }
        
        document.body.appendChild(svg);
        res.send(dom.serialize());
    } catch (error) {
        console.error('Error composing diagram:', error);
        res.status(500).json({ error: error.message });
    }
});

// API to get available shapes
app.get('/shapes', (req, res) => {
    const shapes = Array.from(shapesLibrary.entries()).map(([name, data]) => ({
        name,
        type: data.type,
        face: data.face
    }));
    res.json(shapes);
});

// Serve the testing UI
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`SVG Isometric Shapes Compiler server listening at http://localhost:${port}`);
});
