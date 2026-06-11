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
   카메라 시작
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

        startSimulation();

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
