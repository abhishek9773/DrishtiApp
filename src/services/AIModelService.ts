
import {loadTensorflowModel, TensorflowModel} from 'react-native-fast-tflite';
import jpeg from 'jpeg-js';

const MODEL_ASSET = require('../../assets/models/drishti_efficientdet_lite0.tflite');

const MODEL_WIDTH = 320;
const MODEL_HEIGHT = 320;
const CONFIDENCE_THRESHOLD = 0.45;

export interface DrishtiDetection {
  classId: number;
  confidence: number;
  box: {
    top: number;
    left: number;
    bottom: number;
    right: number;
  };
}

let modelInstance: TensorflowModel | null = null;
let loadingPromise: Promise<TensorflowModel> | null = null;

function getTensorInfo(model: TensorflowModel) {
  return {
    inputs: model.inputs.map(t => ({
      name: t.name,
      shape: t.shape,
      dataType: t.dataType,
    })),
    outputs: model.outputs.map(t => ({
      name: t.name,
      shape: t.shape,
      dataType: t.dataType,
    })),
  };
}

export async function loadDrishtiModel(): Promise<TensorflowModel> {
  if (modelInstance) {
    return modelInstance;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    try {
      const loaded = await loadTensorflowModel(MODEL_ASSET, []);

      modelInstance = loaded;

      console.log(
        '[DRISHTI AI] Model loaded successfully',
        JSON.stringify(getTensorInfo(loaded), null, 2),
      );

      const input = loaded.inputs[0];

      if (
        !input ||
        input.dataType !== 'uint8' ||
        input.shape.join(',') !== '1,320,320,3'
      ) {
        throw new Error(
          `Unexpected model input: ${JSON.stringify(input)}`,
        );
      }

      if (loaded.outputs.length !== 4) {
        throw new Error(
          `Expected 4 outputs, received ${loaded.outputs.length}`,
        );
      }

      return loaded;
    } catch (error) {
      modelInstance = null;
      loadingPromise = null;
      console.error('[DRISHTI AI] Model loading failed:', error);
      throw error;
    }
  })();

  return loadingPromise;
}

/**
 * Convert JPEG bytes to a 320x320 RGB uint8 ArrayBuffer.
 * This currently stretches the image to square dimensions.
 */
function jpegToModelInput(jpegBytes: Uint8Array): ArrayBuffer {
  const decoded = jpeg.decode(jpegBytes, {
    useTArray: true,
    formatAsRGBA: true,
  });

  if (!decoded.width || !decoded.height || !decoded.data) {
    throw new Error('Could not decode camera JPEG');
  }

  const output = new Uint8Array(
    MODEL_WIDTH * MODEL_HEIGHT * 3,
  );

  for (let y = 0; y < MODEL_HEIGHT; y++) {
    const sourceY = Math.min(
      decoded.height - 1,
      Math.floor((y * decoded.height) / MODEL_HEIGHT),
    );

    for (let x = 0; x < MODEL_WIDTH; x++) {
      const sourceX = Math.min(
        decoded.width - 1,
        Math.floor((x * decoded.width) / MODEL_WIDTH),
      );

      const sourceIndex =
        (sourceY * decoded.width + sourceX) * 4;

      const targetIndex =
        (y * MODEL_WIDTH + x) * 3;

      // JPEG decoder returns RGBA; model expects RGB.
      output[targetIndex] = decoded.data[sourceIndex];
      output[targetIndex + 1] = decoded.data[sourceIndex + 1];
      output[targetIndex + 2] = decoded.data[sourceIndex + 2];
    }
  }

  return output.buffer;
}

function outputIndex(
  model: TensorflowModel,
  suffix: string,
): number {
  return model.outputs.findIndex(t =>
    t.name.endsWith(`:${suffix}`),
  );
}

function parseDetections(
  model: TensorflowModel,
  outputs: ArrayBuffer[],
): DrishtiDetection[] {
  // Our Netron screenshots identify:
  // :3 = boxes, :2 = classes, :1 = scores, :0 = count.
  // Resolve their actual positions from the runtime tensor names.
  const boxesIndex = outputIndex(model, '3');
  const classesIndex = outputIndex(model, '2');
  const scoresIndex = outputIndex(model, '1');
  const countIndex = outputIndex(model, '0');

  if (
    boxesIndex < 0 ||
    classesIndex < 0 ||
    scoresIndex < 0 ||
    countIndex < 0
  ) {
    throw new Error(
      'Could not map model output names. Check the AI tensor logs.',
    );
  }

  const boxes = new Float32Array(outputs[boxesIndex]);
  const classes = new Float32Array(outputs[classesIndex]);
  const scores = new Float32Array(outputs[scoresIndex]);
  const countData = new Float32Array(outputs[countIndex]);

  const boxTensor = model.outputs[boxesIndex];
  const boxShape = boxTensor.shape;
  const valuesPerBox = boxShape[boxShape.length - 1];

  if (valuesPerBox !== 4) {
    throw new Error(
      `Unexpected bounding-box shape: ${boxShape.join('x')}`,
    );
  }

  const maxBoxes = Math.min(
    Math.floor(boxes.length / 4),
    classes.length,
    scores.length,
  );

  const count = Math.max(
    0,
    Math.min(Math.floor(countData[0] ?? 0), maxBoxes),
  );

  const detections: DrishtiDetection[] = [];

  for (let i = 0; i < count; i++) {
    const confidence = scores[i];

    if (
      !Number.isFinite(confidence) ||
      confidence < CONFIDENCE_THRESHOLD
    ) {
      continue;
    }

    const offset = i * 4;

    // EfficientDet detection boxes use [top, left, bottom, right].
    const top = boxes[offset];
    const left = boxes[offset + 1];
    const bottom = boxes[offset + 2];
    const right = boxes[offset + 3];

    if (
      ![top, left, bottom, right].every(Number.isFinite)
    ) {
      continue;
    }

    detections.push({
      classId: Math.round(classes[i]),
      confidence,
      box: {
        top: Math.max(0, Math.min(1, top)),
        left: Math.max(0, Math.min(1, left)),
        bottom: Math.max(0, Math.min(1, bottom)),
        right: Math.max(0, Math.min(1, right)),
      },
    });
  }

  return detections;
}

export async function detectObjectsFromJpeg(
  jpegBytes: Uint8Array,
): Promise<DrishtiDetection[]> {
  const model = await loadDrishtiModel();

  const inputBuffer = jpegToModelInput(jpegBytes);

  const outputs = await model.run([inputBuffer]);

  return parseDetections(model, outputs);
}

export function getDrishtiModelInfo() {
  if (!modelInstance) {
    return null;
  }

  return getTensorInfo(modelInstance);
}
