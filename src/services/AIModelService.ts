
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

  export interface DrishtiInferenceResult {
    detections: DrishtiDetection[];
    preprocessMs: number;
    inferenceMs: number;
    totalMs: number;
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
    if (modelInstance) return modelInstance;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      try {
        const loaded = await loadTensorflowModel(MODEL_ASSET, []);

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

        modelInstance = loaded;

        console.log(
          '[DRISHTI AI] Model loaded:',
          JSON.stringify(getTensorInfo(loaded), null, 2),
        );

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

  function jpegToModelInput(jpegBytes: Uint8Array): ArrayBuffer {
    const decoded = jpeg.decode(jpegBytes, {
      useTArray: true,
      formatAsRGBA: true,
    });

    if (!decoded.width || !decoded.height || !decoded.data) {
      throw new Error('Could not decode camera JPEG');
    }

    const output = new Uint8Array(MODEL_WIDTH * MODEL_HEIGHT * 3);

    // Nearest-neighbour resize. This is simple and avoids extra allocations.
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

        const sourceIndex = (sourceY * decoded.width + sourceX) * 4;
        const targetIndex = (y * MODEL_WIDTH + x) * 3;

        output[targetIndex] = decoded.data[sourceIndex];
        output[targetIndex + 1] = decoded.data[sourceIndex + 1];
        output[targetIndex + 2] = decoded.data[sourceIndex + 2];
      }
    }

    return output.buffer;
  }

  function findOutputIndex(
    model: TensorflowModel,
    suffix: string,
  ): number {
    return model.outputs.findIndex(t => t.name.endsWith(`:${suffix}`));
  }

  function parseDetections(
    model: TensorflowModel,
    outputs: ArrayBuffer[],
  ): DrishtiDetection[] {
    const boxesIndex = findOutputIndex(model, '3');
    const classesIndex = findOutputIndex(model, '2');
    const scoresIndex = findOutputIndex(model, '1');
    const countIndex = findOutputIndex(model, '0');

    if (
      boxesIndex < 0 ||
      classesIndex < 0 ||
      scoresIndex < 0 ||
      countIndex < 0
    ) {
      throw new Error(
        'Could not map model output tensors. Check the runtime tensor logs.',
      );
    }

    const boxes = new Float32Array(outputs[boxesIndex]);
    const classes = new Float32Array(outputs[classesIndex]);
    const scores = new Float32Array(outputs[scoresIndex]);
    const countData = new Float32Array(outputs[countIndex]);

    const boxShape = model.outputs[boxesIndex].shape;
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

    const rawCount = Number(countData[0] ?? 0);
    const count = Math.max(
      0,
      Math.min(Math.floor(rawCount), maxBoxes),
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
      const top = boxes[offset];
      const left = boxes[offset + 1];
      const bottom = boxes[offset + 2];
      const right = boxes[offset + 3];

      if (![top, left, bottom, right].every(Number.isFinite)) {
        continue;
      }

      const normalizedBox = {
        top: Math.max(0, Math.min(1, top)),
        left: Math.max(0, Math.min(1, left)),
        bottom: Math.max(0, Math.min(1, bottom)),
        right: Math.max(0, Math.min(1, right)),
      };

      if (
        normalizedBox.bottom <= normalizedBox.top ||
        normalizedBox.right <= normalizedBox.left
      ) {
        continue;
      }

      detections.push({
        classId: Math.round(classes[i]),
        confidence,
        box: normalizedBox,
      });
    }

    return detections;
  }

  export async function detectObjectsFromJpeg(
    jpegBytes: Uint8Array,
  ): Promise<DrishtiInferenceResult> {
    const totalStarted = Date.now();
    const model = await loadDrishtiModel();

    const preprocessStarted = Date.now();
    const inputBuffer = jpegToModelInput(jpegBytes);
    const preprocessMs = Date.now() - preprocessStarted;

    const inferenceStarted = Date.now();
    const outputs = await model.run([inputBuffer]);
    const inferenceMs = Date.now() - inferenceStarted;

    const detections = parseDetections(model, outputs);
    const totalMs = Date.now() - totalStarted;

    return {
      detections,
      preprocessMs,
      inferenceMs,
      totalMs,
    };
  }

  export function getDrishtiModelInfo() {
    return modelInstance ? getTensorInfo(modelInstance) : null;
  }
