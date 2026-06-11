import {
    FaceLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const video = document.getElementById("video");

const scoreText = document.getElementById("score");
const statusText = document.getElementById("status");

const gaugeFill = document.getElementById("gaugeFill");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const downloadBtn = document.getElementById("downloadBtn");

const drowsyAlert = document.getElementById("drowsyAlert");

let stream = null;
let analysisInterval = null;

let focusData = [];

/* =========================
   3단계: 전역 변수 추가
========================= */
let faceLandmarker;
let runningMode = "VIDEO";

/* =========================
   카메라 시작 (8단계 수정 반영)
========================= */
async function startCamera() {

    // 이미 실행 중이면 무시
    if (analysisInterval) {
        return;
    }

    try {

        stream = await navigator.mediaDevices.getUserMedia({
            video: true
        });

        video.srcObject = stream;

        statusText.textContent = "ANALYZING";

        // 기존 startSimulation(); 삭제 후 analyzeFrame(); 추가
        analyzeFrame();

    } catch (error) {

        alert("카메라 접근이 거부되었습니다.");

        console.error(error);
    }
}

startBtn.addEventListener("click", startCamera);

/* =========================
   집중도 시뮬레이션
   (추후 MediaPipe 코드로 교체)
========================= */
function startSimulation() {

    analysisInterval = setInterval(() => {

        // 현재는 테스트용 랜덤 점수
        let score = Math.floor(Math.random() * 100);

        let status = "";

        if (score >= 80) {

            status = "HIGH FOCUS";
            gaugeFill.style.background = "green";

        } else if (score >= 40) {

            status = "MEDIUM FOCUS";
            gaugeFill.style.background = "orange";

        } else {

            status = "LOW FOCUS";
            gaugeFill.style.background = "red";
        }

        scoreText.textContent = score;
        statusText.textContent = status;

        gaugeFill.style.width = score + "%";

        focusData.push({

            timestamp: new Date().toLocaleTimeString(),
            score: score,
            status: status

        });

        // DROWSY 테스트
        if (score < 15) {

            drowsyAlert.classList.remove("hidden");

        } else {

            drowsyAlert.classList.add("hidden");
        }

        updateChart(score);

    }, 1000);
}

/* =========================
   차트
========================= */
const ctx = document.getElementById("focusChart");

const chart = new Chart(ctx, {

    type: "line",

    data: {

        labels: [],

        datasets: [{
            label: "Focus Score",
            data: []
        }]
    },

    options: {

        responsive: true,

        scales: {

            y: {
                min: 0,
                max: 100
            }
        }
    }
});

function updateChart(score) {

    chart.data.labels.push(
        new Date().toLocaleTimeString()
    );

    chart.data.datasets[0].data.push(score);

    if (chart.data.labels.length > 30) {

        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
    }

    chart.update();
}

/* =========================
   CSV 다운로드
========================= */
downloadBtn.addEventListener("click", () => {

    let csv = "timestamp,focus_score,status\n";

    focusData.forEach(row => {

        csv +=
            `${row.timestamp},${row.score},${row.status}\n`;

    });

    const blob = new Blob(
        [csv],
        { type: "text/csv" }
    );

    const link =
        document.createElement("a");

    link.href =
        URL.createObjectURL(blob);

    link.download =
        "focus_data.csv";

    link.click();
});

/* =========================
   분석 중지
========================= */
stopBtn.addEventListener(
    "click",
    stopAnalysis
);

function stopAnalysis() {

    // 반복 분석 중지
    if (analysisInterval) {

        clearInterval(analysisInterval);
        analysisInterval = null;
    }

    // 카메라 종료
    if (stream) {

        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    // 비디오 초기화
    video.srcObject = null;

    // 경고 숨김
    drowsyAlert.classList.add("hidden");

    // UI 초기화
    statusText.textContent = "STOPPED";
    scoreText.textContent = "0";

    gaugeFill.style.width = "0%";
}

/* =========================
   3단계: FaceLandmarker 생성 함수
========================= */
async function createFaceLandmarker() {

    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    faceLandmarker =
        await FaceLandmarker.createFromOptions(
            vision,
            {
                baseOptions: {
                    modelAssetPath:
                    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
                },

                runningMode: "VIDEO",

                numFaces: 1,

                outputFaceBlendshapes: false,

                outputFacialTransformationMatrixes: false
            }
        );
}

/* =========================
   5단계: 랜드마크 분석 함수
========================= */
async function analyzeFrame() {

    if (
        !faceLandmarker ||
        !video.videoWidth
    ) {
        requestAnimationFrame(analyzeFrame);
        return;
    }

    const results =
        faceLandmarker.detectForVideo(
            video,
            performance.now()
        );

    if (
        results.faceLandmarks &&
        results.faceLandmarks.length > 0
    ) {

        const landmarks =
            results.faceLandmarks[0];

        calculateFocus(landmarks);
    }

    requestAnimationFrame(analyzeFrame);
}

/* =========================
   6단계: 홍채 좌표 추출
========================= */
function calculateFocus(landmarks) {

    const leftIris =
        landmarks[468];

    const rightIris =
        landmarks[473];

    const leftEyeLeft =
        landmarks[33];

    const leftEyeRight =
        landmarks[133];

    const rightEyeLeft =
        landmarks[362];

    const rightEyeRight =
        landmarks[263];

    const leftRatio =
        (leftIris.x - leftEyeLeft.x) /
        (leftEyeRight.x - leftEyeLeft.x);

    const rightRatio =
        (rightIris.x - rightEyeLeft.x) /
        (rightEyeRight.x - rightEyeLeft.x);

    const gaze =
        (leftRatio + rightRatio) / 2;

    updateFocus(gaze);
}

/* =========================
   7단계: 집중도 계산
========================= */
function updateFocus(gaze) {

    let score;
    let status;

    if (
        gaze > 0.40 &&
        gaze < 0.60
    ) {

        score = 100;
        status = "HIGH FOCUS";

        gaugeFill.style.background =
            "green";

    }

    else if (
        gaze > 0.30 &&
        gaze < 0.70
    ) {

        score = 70;
        status = "MEDIUM FOCUS";

        gaugeFill.style.background =
            "orange";
    }

    else {

        score = 30;
        status = "LOW FOCUS";

        gaugeFill.style.background =
            "red";
    }

    scoreText.textContent =
        score;

    statusText.textContent =
        status;

    gaugeFill.style.width =
        score + "%";
}

/* =========================
   4단계: 페이지 로드시 모델 준비
========================= */
createFaceLandmarker();
