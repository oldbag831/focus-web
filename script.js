import {
    FaceLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// ===== DOM Elements =====
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");
const scoreText = document.getElementById("score");
const statusText = document.getElementById("status");
const gaugeFill = document.getElementById("gaugeFill");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const downloadBtn = document.getElementById("downloadBtn");
const drowsyAlert = document.getElementById("drowsyAlert");
const mpStatus = document.getElementById("mpStatus");
const calibrationOverlay = document.getElementById("calibrationOverlay");
const calibrationProgress = document.getElementById("calibrationProgress");
const gazeValueEl = document.getElementById("gazeValue");
const earValueEl = document.getElementById("earValue");

// ===== MediaPipe Landmark Indices =====
const LEFT_IRIS = 468;
const RIGHT_IRIS = 473;
const LEFT_EYE_OUTER = 33;
const LEFT_EYE_INNER = 133;
const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_OUTER = 263;

// EAR landmarks
const LEFT_EAR_POINTS = [33, 160, 158, 133, 153, 144];
const RIGHT_EAR_POINTS = [362, 385, 387, 263, 373, 380];

// ===== Constants =====
const MEDIAPIPE_VERSION = "0.10.14";
const MODEL_URL =
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

const CALIBRATION_DURATION_MS = 3000;
const DROWSY_EAR_THRESHOLD = 0.21;
const DROWSY_DURATION_MS = 2000;
const DATA_INTERVAL_MS = 1000;
const CHART_MAX_POINTS = 300; // 5 minutes at 1 sample/sec

// Gaze thresholds (absolute, used before/during calibration fallback)
const GAZE_HIGH_MIN = 0.40;
const GAZE_HIGH_MAX = 0.60;
const GAZE_MED_MIN = 0.30;
const GAZE_MED_MAX = 0.70;

// Calibrated deviation thresholds
const DEV_HIGH = 0.10;
const DEV_MED = 0.20;

// ===== State =====
let faceLandmarker = null;
let stream = null;
let animationFrameId = null;
let dataIntervalId = null;
let lastVideoTime = -1;

let isAnalyzing = false;
let isCalibrating = false;
let calibrationStartTime = 0;
let calibrationSamples = [];

let gazeBaseline = null; // personal center gaze ratio
let focusData = [];
let drowsyStartTime = null;
let lastScore = 0;
let lastStatus = "READY";

// ===== Chart.js Setup =====
const chartCtx = document.getElementById("focusChart").getContext("2d");
const focusChart = new Chart(chartCtx, {
    type: "line",
    data: {
        labels: [],
        datasets: [{
            label: "Focus Score",
            data: [],
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            fill: true,
            tension: 0.3,
            pointRadius: 2
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            y: {
                min: 0,
                max: 100,
                grid: { color: "rgba(255,255,255,0.05)" },
                ticks: { color: "#94a3b8" }
            },
            x: {
                grid: { color: "rgba(255,255,255,0.05)" },
                ticks: { color: "#94a3b8", maxTicksLimit: 10 }
            }
        },
        plugins: {
            legend: { labels: { color: "#e2e8f0" } }
        }
    }
});

// ===== MediaPipe Initialization =====
async function initMediaPipe() {
    try {
        mpStatus.textContent = "MediaPipe Loading...";
        mpStatus.className = "mp-status";

        const vision = await FilesetResolver.forVisionTasks(
            `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
        );

        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: MODEL_URL,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: false
        });

        mpStatus.textContent = "MediaPipe Ready";
        mpStatus.className = "mp-status ready";
        startBtn.disabled = false;
    } catch (err) {
        console.error("MediaPipe init failed:", err);
        mpStatus.textContent = "MediaPipe Error — 새로고침 후 재시도";
        mpStatus.className = "mp-status error";
    }
}

// ===== Geometry Helpers =====
function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function computeEAR(landmarks, indices) {
    const [p1, p2, p3, p4, p5, p6] = indices.map((i) => landmarks[i]);
    const vertical1 = dist(p2, p6);
    const vertical2 = dist(p3, p5);
    const horizontal = dist(p1, p4);
    if (horizontal === 0) return 0;
    return (vertical1 + vertical2) / (2 * horizontal);
}

function computeGazeRatio(landmarks) {
    const leftIris = landmarks[LEFT_IRIS];
    const rightIris = landmarks[RIGHT_IRIS];
    const leftOuter = landmarks[LEFT_EYE_OUTER];
    const leftInner = landmarks[LEFT_EYE_INNER];
    const rightInner = landmarks[RIGHT_EYE_INNER];
    const rightOuter = landmarks[RIGHT_EYE_OUTER];

    const leftWidth = leftInner.x - leftOuter.x;
    const rightWidth = rightOuter.x - rightInner.x;

    if (Math.abs(leftWidth) < 0.001 || Math.abs(rightWidth) < 0.001) {
        return null;
    }

    const leftRatio = (leftIris.x - leftOuter.x) / leftWidth;
    const rightRatio = (rightIris.x - rightInner.x) / rightWidth;

    return (leftRatio + rightRatio) / 2;
}

// ===== Focus Scoring =====
function classifyGaze(gazeRatio) {
    if (gazeBaseline !== null) {
        const dev = Math.abs(gazeRatio - gazeBaseline);
        if (dev <= DEV_HIGH) return { score: 100, status: "HIGH FOCUS" };
        if (dev <= DEV_MED) return { score: 70, status: "MEDIUM FOCUS" };
        return { score: 30, status: "LOW FOCUS" };
    }

    if (gazeRatio >= GAZE_HIGH_MIN && gazeRatio <= GAZE_HIGH_MAX) {
        return { score: 100, status: "HIGH FOCUS" };
    }
    if (gazeRatio >= GAZE_MED_MIN && gazeRatio <= GAZE_MED_MAX) {
        return { score: 70, status: "MEDIUM FOCUS" };
    }
    return { score: 30, status: "LOW FOCUS" };
}

function evaluateDrowsiness(ear, now) {
    if (ear < DROWSY_EAR_THRESHOLD) {
        if (drowsyStartTime === null) drowsyStartTime = now;
        if (now - drowsyStartTime >= DROWSY_DURATION_MS) {
            return true;
        }
    } else {
        drowsyStartTime = null;
    }
    return false;
}

// ===== Canvas Drawing =====
function drawOverlay(landmarks, gazeRatio) {
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

    const w = overlay.width;
    const h = overlay.height;

    // Eye region outlines
    overlayCtx.strokeStyle = "rgba(59, 130, 246, 0.5)";
    overlayCtx.lineWidth = 1;

    const drawEyeBox = (outer, inner) => {
        const x = Math.min(outer.x, inner.x) * w;
        const y = Math.min(outer.y, inner.y) * h - 5;
        const bw = Math.abs(inner.x - outer.x) * w;
        const bh = 20;
        overlayCtx.strokeRect(x, y, bw, bh);
    };

    drawEyeBox(landmarks[LEFT_EYE_OUTER], landmarks[LEFT_EYE_INNER]);
    drawEyeBox(landmarks[RIGHT_EYE_INNER], landmarks[RIGHT_EYE_OUTER]);

    // Iris centers
    const drawIris = (idx, color) => {
        const lm = landmarks[idx];
        const x = lm.x * w;
        const y = lm.y * h;
        overlayCtx.beginPath();
        overlayCtx.arc(x, y, 6, 0, Math.PI * 2);
        overlayCtx.fillStyle = color;
        overlayCtx.fill();
        overlayCtx.strokeStyle = "#fff";
        overlayCtx.lineWidth = 2;
        overlayCtx.stroke();
    };

    drawIris(LEFT_IRIS, "#22c55e");
    drawIris(RIGHT_IRIS, "#22c55e");

    // Gaze info text
    if (gazeRatio !== null) {
        overlayCtx.fillStyle = "rgba(255,255,255,0.9)";
        overlayCtx.font = "14px sans-serif";
        overlayCtx.fillText(`Gaze: ${gazeRatio.toFixed(3)}`, 10, 24);
        if (gazeBaseline !== null) {
            overlayCtx.fillText(`Baseline: ${gazeBaseline.toFixed(3)}`, 10, 44);
        }
    }
}

function syncCanvasSize() {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
}

// ===== UI Updates =====
function updateUI(score, status) {
    lastScore = score;
    lastStatus = status;

    scoreText.textContent = score;
    statusText.textContent = status;
    statusText.className = "status-value";

    if (status === "HIGH FOCUS") statusText.classList.add("high-focus");
    else if (status === "MEDIUM FOCUS") statusText.classList.add("medium-focus");
    else if (status === "LOW FOCUS") statusText.classList.add("low-focus");
    else if (status === "DROWSY") statusText.classList.add("drowsy");

    gaugeFill.style.width = `${score}%`;

    if (status === "DROWSY") {
        drowsyAlert.classList.remove("hidden");
    } else {
        drowsyAlert.classList.add("hidden");
    }
}

function recordDataPoint() {
    const now = new Date();
    const timestamp = now.toLocaleTimeString("ko-KR", { hour12: false });
    focusData.push({ timestamp, score: lastScore, status: lastStatus });

    focusChart.data.labels.push(timestamp);
    focusChart.data.datasets[0].data.push(lastScore);

    if (focusChart.data.labels.length > CHART_MAX_POINTS) {
        focusChart.data.labels.shift();
        focusChart.data.datasets[0].data.shift();
    }
    focusChart.update("none");
}

// ===== Main Detection Loop =====
function detectFrame() {
    if (!isAnalyzing || !faceLandmarker) return;

    const now = performance.now();

    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;

        const results = faceLandmarker.detectForVideo(video, now);

        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
            const landmarks = results.faceLandmarks[0];
            const gazeRatio = computeGazeRatio(landmarks);
            const ear =
                (computeEAR(landmarks, LEFT_EAR_POINTS) +
                    computeEAR(landmarks, RIGHT_EAR_POINTS)) /
                2;

            gazeValueEl.textContent = gazeRatio !== null ? gazeRatio.toFixed(3) : "—";
            earValueEl.textContent = ear.toFixed(3);

            drawOverlay(landmarks, gazeRatio);

            // Calibration phase
            if (isCalibrating) {
                const elapsed = now - calibrationStartTime;
                const progress = Math.min(elapsed / CALIBRATION_DURATION_MS, 1);
                calibrationProgress.style.width = `${progress * 100}%`;

                if (gazeRatio !== null) {
                    calibrationSamples.push(gazeRatio);
                }

                if (elapsed >= CALIBRATION_DURATION_MS) {
                    finishCalibration();
                }
            } else if (gazeRatio !== null) {
                // Drowsiness check (overrides gaze-based score)
                const isDrowsy = evaluateDrowsiness(ear, now);

                if (isDrowsy) {
                    updateUI(10, "DROWSY");
                } else {
                    const { score, status } = classifyGaze(gazeRatio);
                    updateUI(score, status);
                }
            }
        } else {
            overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
            gazeValueEl.textContent = "—";
        }
    }

    animationFrameId = requestAnimationFrame(detectFrame);
}

function finishCalibration() {
    isCalibrating = false;
    calibrationOverlay.classList.add("hidden");

    if (calibrationSamples.length > 0) {
        gazeBaseline =
            calibrationSamples.reduce((a, b) => a + b, 0) /
            calibrationSamples.length;
    }

    calibrationSamples = [];
    statusText.textContent = "ANALYZING";
}

// ===== Camera & Analysis Control =====
async function startAnalysis() {
    if (!faceLandmarker) {
        alert("MediaPipe가 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.");
        return;
    }

    if (isAnalyzing) return;

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }
        });
        video.srcObject = stream;

        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                resolve();
            };
        });

        syncCanvasSize();

        isAnalyzing = true;
        isCalibrating = true;
        calibrationStartTime = performance.now();
        calibrationSamples = [];
        gazeBaseline = null;
        drowsyStartTime = null;
        focusData = [];
        lastVideoTime = -1;

        calibrationOverlay.classList.remove("hidden");
        calibrationProgress.style.width = "0%";

        startBtn.disabled = true;
        stopBtn.disabled = false;

        animationFrameId = requestAnimationFrame(detectFrame);

        if (dataIntervalId) clearInterval(dataIntervalId);
        dataIntervalId = setInterval(recordDataPoint, DATA_INTERVAL_MS);
    } catch (err) {
        console.error("Camera error:", err);
        alert("카메라 접근에 실패했습니다. 브라우저에서 카메라 권한을 허용해 주세요.");
    }
}

function stopAnalysis() {
    isAnalyzing = false;
    isCalibrating = false;

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    if (dataIntervalId) {
        clearInterval(dataIntervalId);
        dataIntervalId = null;
    }

    if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
    }

    video.srcObject = null;
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

    calibrationOverlay.classList.add("hidden");
    drowsyAlert.classList.add("hidden");

    updateUI(0, "STOPPED");
    gazeValueEl.textContent = "—";
    earValueEl.textContent = "—";

    startBtn.disabled = false;
    stopBtn.disabled = true;
}

function downloadCSV() {
    if (focusData.length === 0) {
        alert("다운로드할 데이터가 없습니다. 먼저 분석을 실행해 주세요.");
        return;
    }

    const header = "timestamp,focus_score,status\n";
    const rows = focusData
        .map((d) => `${d.timestamp},${d.score},${d.status}`)
        .join("\n");

    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "focus_data.csv";
    a.click();
    URL.revokeObjectURL(url);
}

// ===== Event Listeners =====
startBtn.disabled = true;
startBtn.addEventListener("click", startAnalysis);
stopBtn.addEventListener("click", stopAnalysis);
downloadBtn.addEventListener("click", downloadCSV);

window.addEventListener("resize", () => {
    if (video.videoWidth) syncCanvasSize();
});

// ===== Boot =====
initMediaPipe();
