const video = document.getElementById("video");

const scoreText = document.getElementById("score");
const statusText = document.getElementById("status");

const gaugeFill = document.getElementById("gaugeFill");

const startBtn = document.getElementById("startBtn");

const stopBtn = document.getElementById("stopBtn");

let stream = null;
let analysisInterval = null;

const downloadBtn = document.getElementById("downloadBtn");

const drowsyAlert = document.getElementById("drowsyAlert");

let focusData = [];

async function startCamera() {

    try {

        stream = await navigator.mediaDevices.getUserMedia({
            video: true
        });

        video.srcObject = stream;

        startSimulation();

    }

    catch(error){

        alert("카메라 접근이 거부되었습니다.");

        console.error(error);

    }
}

startBtn.addEventListener("click", startCamera);

function startSimulation(){

    analysisInterval = setInterval(() => {

        let score =
            Math.floor(Math.random()*100);

        let status = "";

        if(score >= 80){

            status = "HIGH FOCUS";

            gaugeFill.style.background = "green";
        }

        else if(score >= 40){

            status = "MEDIUM FOCUS";

            gaugeFill.style.background = "orange";
        }

        else{

            status = "LOW FOCUS";

            gaugeFill.style.background = "red";
        }

        scoreText.textContent = score;

        statusText.textContent = status;

        gaugeFill.style.width = score + "%";

        focusData.push({

            timestamp:new Date().toLocaleTimeString(),

            score:score,

            status:status

        });

        if(score < 15){

            drowsyAlert.classList.remove("hidden");
        }
        else{

            drowsyAlert.classList.add("hidden");
        }

        updateChart(score);

    },1000);
}

const ctx =
document.getElementById("focusChart");

const chart = new Chart(ctx,{

    type:"line",

    data:{
        labels:[],
        datasets:[{
            label:"Focus Score",
            data:[]
        }]
    },

    options:{
        responsive:true,
        scales:{
            y:{
                min:0,
                max:100
            }
        }
    }

});

function updateChart(score){

    chart.data.labels.push(
        new Date().toLocaleTimeString()
    );

    chart.data.datasets[0].data.push(score);

    if(chart.data.labels.length > 30){

        chart.data.labels.shift();

        chart.data.datasets[0].data.shift();
    }

    chart.update();
}

downloadBtn.addEventListener("click",()=>{

    let csv =
        "timestamp,focus_score,status\n";

    focusData.forEach(row=>{

        csv +=
        `${row.timestamp},${row.score},${row.status}\n`;

    });

    const blob =
        new Blob([csv],{
            type:"text/csv"
        });

    const link =
        document.createElement("a");

    link.href =
        URL.createObjectURL(blob);

    link.download =
        "focus_data.csv";

    link.click();
});

stopBtn.addEventListener(
    "click",
    stopAnalysis
);

function stopAnalysis() {

    if(analysisInterval) {

        clearInterval(analysisInterval);
    }

    if(stream) {

        stream.getTracks().forEach(track => track.stop());
    }

    video.srcObject = null;

    statusText.textContent = "STOPPED";
}
