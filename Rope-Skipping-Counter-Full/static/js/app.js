(() => {
  const $ = (s) => document.querySelector(s);
  const video = $("#video"), canvas = $("#overlay"), ctx = canvas.getContext("2d");
  const countEl=$("#count"), timerEl=$("#timer"), rateEl=$("#rate"), statusEl=$("#ai-status");
  const startBtn=$("#start-camera"), pauseBtn=$("#pause"), resetBtn=$("#reset"), finishBtn=$("#finish");
  const placeholder=$("#placeholder"), cameraState=$("#camera-state"), goalBar=$("#goal-progress"), goalNote=$("#goal-note");
  const GOAL=300;
  let stream=null, landmarker=null, running=false, paused=false, raf=null, count=0;
  let startAt=0, elapsed=0, lastTick=0, calibration=[], baseline=null, state="ground", airStart=0, lastCountAt=0, smoothHip=null;
  let sessionActive=false, lastRateUpdate=0;
  const historyKey="rope-counter-history-v1";

  function fmtTime(sec){sec=Math.max(0,Math.floor(sec));return `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`}
  function setStatus(msg){statusEl.textContent=msg}
  function resizeCanvas(){const rect=video.getBoundingClientRect(); if(rect.width && rect.height){canvas.width=Math.round(rect.width*devicePixelRatio);canvas.height=Math.round(rect.height*devicePixelRatio);canvas.style.width=rect.width+"px";canvas.style.height=rect.height+"px";ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0)}}
  window.addEventListener("resize",resizeCanvas);

  async function setupAI(){
    if(landmarker) return landmarker;
    if(!window.vision){throw new Error("Thư viện AI chưa tải. Kiểm tra Internet rồi tải lại trang.")}
    setStatus("Đang tải AI…");
    const vision=await window.vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
    landmarker=await window.vision.PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",delegate:"GPU"},runningMode:"VIDEO",numPoses:1});
    setStatus("AI sẵn sàng");return landmarker;
  }
  async function startCamera(){
    try{
      startBtn.disabled=true; setStatus("Đang xin quyền camera…");
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:720},height:{ideal:1280}},audio:false});
      video.srcObject=stream; await video.play(); resizeCanvas(); placeholder.style.display="none"; cameraState.textContent="CAMERA ON";
      await setupAI(); running=true; paused=false; sessionActive=true; startAt=performance.now()-elapsed*1000; lastTick=performance.now();
      pauseBtn.disabled=false; finishBtn.disabled=false; pauseBtn.textContent="Ⅱ Tạm dừng"; startBtn.textContent="● Đang tập";
      loop(); setStatus("Đang nhận diện"); $("#camera-message").style.display="none";
    }catch(e){startBtn.disabled=false; setStatus("Không mở được camera"); showError(cameraExplain(e));}
  }
  function cameraExplain(e){
    if(e?.name==="NotAllowedError")return "Bạn chưa cấp quyền camera. Hãy cho phép camera trong cài đặt trình duyệt.";
    if(e?.name==="NotFoundError")return "Không tìm thấy camera trên thiết bị.";
    if(e?.name==="NotReadableError")return "Camera đang được ứng dụng khác sử dụng.";
    return e?.message||"Camera cần HTTPS hoặc localhost và trình duyệt hỗ trợ.";
  }
  function showError(msg){const el=$("#camera-message");el.textContent=msg;el.style.display="block";alert(msg)}
  function getHip(landmarks){
    const l=landmarks[23],r=landmarks[24]; if(!l||!r||l.visibility<.45||r.visibility<.45)return null;
    return (l.y+r.y)/2;
  }
  function loop(){
    if(!running||paused)return;
    const now=performance.now();
    if(video.readyState>=2&&landmarker){
      const result=landmarker.detectForVideo(video,now);
      ctx.clearRect(0,0,canvas.width/devicePixelRatio,canvas.height/devicePixelRatio);
      if(result.landmarks?.length){
        const pts=result.landmarks[0]; drawPose(pts);
        const hip=getHip(pts);
        if(hip!==null)processHip(hip,now);
        setStatus(baseline===null?"Đang hiệu chỉnh tư thế…":"Đang theo dõi chuyển động");
      }else{setStatus("Không thấy cơ thể — hãy đứng trọn khung hình")}
    }
    updateTimer(now); raf=requestAnimationFrame(loop);
  }
  function drawPose(p){
    const w=canvas.width/devicePixelRatio,h=canvas.height/devicePixelRatio;
    const connections=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[28,30],[27,31],[28,32]];
    ctx.lineWidth=3;ctx.strokeStyle="#c4ff4d";ctx.fillStyle="#c4ff4d";
    connections.forEach(([a,b])=>{if(p[a]?.visibility>.4&&p[b]?.visibility>.4){ctx.beginPath();ctx.moveTo(p[a].x*w,p[a].y*h);ctx.lineTo(p[b].x*w,p[b].y*h);ctx.stroke()}});
    p.forEach(pt=>{if(pt.visibility>.5){ctx.beginPath();ctx.arc(pt.x*w,pt.y*h,3,0,Math.PI*2);ctx.fill()}});
  }
  function processHip(hip,now){
    smoothHip=smoothHip===null?hip:smoothHip*.72+hip*.28;
    if(baseline===null){calibration.push(smoothHip); if(calibration.length>=50){const sorted=[...calibration].sort((a,b)=>a-b);baseline=sorted[Math.floor(sorted.length/2)];$("#camera-message").textContent="Đã hiệu chỉnh. Hãy nhảy đều!";$("#camera-message").style.display="block";setTimeout(()=>$("#camera-message").style.display="none",2200)}return}
    // y decreases when the hips move upward. Thresholds are relative to the user's calibrated standing position.
    const rise=baseline-smoothHip;
    if(state==="ground"&&rise>.028){state="air";airStart=now}
    else if(state==="air"&&rise<.012){
      const airDuration=now-airStart;
      if(airDuration>=120 && airDuration<=1800 && now-lastCountAt>450){
        count++;lastCountAt=now;countEl.textContent=count;updateGoal();updateRate(now);
      }
      state="ground";
      // Slowly adapt standing baseline to natural posture drift without following the jump itself.
      baseline=baseline*.985+smoothHip*.015;
    }
  }
  function updateRate(now){const mins=Math.max((now-startAt)/60000,.01);rateEl.textContent=(count/mins).toFixed(1)}
  function updateTimer(now){elapsed=(now-startAt)/1000;timerEl.textContent=fmtTime(elapsed);if(now-lastRateUpdate>1000){updateRate(now);lastRateUpdate=now}}
  function updateGoal(){const pct=Math.min(count/GOAL*100,100);goalBar.style.width=pct+"%";goalNote.textContent=count>=GOAL?"Đã hoàn thành mục tiêu!":`Còn ${Math.max(0,GOAL-count)} lần để đạt mục tiêu`}
  function pauseToggle(){
    if(!sessionActive)return;
    if(!paused){paused=true;elapsed=(performance.now()-startAt)/1000;cancelAnimationFrame(raf);pauseBtn.textContent="▶ Tiếp tục";setStatus("Đã tạm dừng")}
    else{paused=false;startAt=performance.now()-elapsed*1000;lastTick=performance.now();pauseBtn.textContent="Ⅱ Tạm dừng";loop();setStatus("Đang tập")}
  }
  function resetSession(){
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}video.srcObject=null;cancelAnimationFrame(raf);running=false;paused=false;count=0;elapsed=0;baseline=null;calibration=[];smoothHip=null;state="ground";airStart=0;lastCountAt=0;sessionActive=false;
    countEl.textContent="0";timerEl.textContent="00:00";rateEl.textContent="0.0";goalBar.style.width="0%";goalNote.textContent="Bắt đầu để theo dõi tiến độ";
    ctx.clearRect(0,0,canvas.width,canvas.height);placeholder.style.display="flex";cameraState.textContent="CAMERA OFF";pauseBtn.disabled=true;finishBtn.disabled=true;pauseBtn.textContent="Ⅱ Tạm dừng";startBtn.disabled=false;startBtn.textContent="▶ Bật camera & bắt đầu";setStatus("AI chưa khởi tạo");
  }
  function saveWorkout(){
    if(!sessionActive)return;
    const workout={id:Date.now(),date:new Date().toISOString(),count,duration:Math.round(elapsed),rate:elapsed>0?+(count/(elapsed/60)).toFixed(1):0};
    const h=getHistory();h.unshift(workout);localStorage.setItem(historyKey,JSON.stringify(h.slice(0,100)));renderHistory();renderStats();resetSession();
  }
  function getHistory(){try{return JSON.parse(localStorage.getItem(historyKey)||"[]")}catch{return []}}
  function renderHistory(){
    const list=$("#history-list"),h=getHistory();list.innerHTML="";
    if(!h.length){list.innerHTML='<p class="muted">Chưa có buổi tập nào. Hoàn thành buổi đầu tiên để xem lịch sử.</p>';return}
    h.forEach(item=>{const row=document.createElement("div");row.className="history-row";const date=new Date(item.date).toLocaleString("vi-VN");row.innerHTML=`<div><strong>${item.count.toLocaleString("vi-VN")} lần</strong><small>${date} · ${fmtTime(item.duration)} · ${item.rate} lần/phút</small></div><span class="green">✓</span>`;list.appendChild(row)})
  }
  function renderStats(){
    const h=getHistory();$("#sessions-total").textContent=h.length;$("#jumps-total").textContent=h.reduce((s,x)=>s+x.count,0).toLocaleString("vi-VN");$("#record-total").textContent=h.reduce((m,x)=>Math.max(m,x.count),0).toLocaleString("vi-VN");drawChart(h.slice(0,7).reverse());
  }
  function drawChart(data){
    const cv=$("#chart"),empty=$("#chart-empty");if(!cv)return;const c=cv.getContext("2d"),w=cv.width,h=cv.height;c.clearRect(0,0,w,h);
    if(!data.length){empty.style.display="block";return}empty.style.display="none";
    const pad=45,max=Math.max(1,...data.map(x=>x.count));c.strokeStyle="#303a35";c.fillStyle="#87938d";c.font="14px Inter";c.lineWidth=1;
    for(let i=0;i<=4;i++){let y=pad+(h-pad*1.5)*i/4;c.beginPath();c.moveTo(pad,y);c.lineTo(w-20,y);c.stroke();c.fillText(Math.round(max*(4-i)/4),5,y+4)}
    const step=(w-pad-20)/data.length;data.forEach((x,i)=>{let bh=(h-pad*1.5)*x.count/max,bx=pad+i*step+step*.18,by=h-pad-bh,bw=step*.64;c.fillStyle="#c4ff4d";c.beginPath();c.roundRect(bx,by,bw,bh,5);c.fill();c.fillStyle="#8c9892";c.fillText(new Date(x.date).toLocaleDateString("vi-VN",{day:"2-digit",month:"2-digit"}),bx,h-8)});
  }
  function switchPage(page){
    document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));$("#page-"+page).classList.add("active");
    document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
    $("#page-title").textContent=page==="workout"?"Buổi tập của bạn":page==="history"?"Lịch sử tập luyện":"Thống kê";
    if(page==="history")renderHistory();if(page==="stats")renderStats();
  }
  document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>switchPage(b.dataset.page)));
  startBtn.addEventListener("click",startCamera);pauseBtn.addEventListener("click",pauseToggle);resetBtn.addEventListener("click",()=>{if(confirm("Reset buổi tập hiện tại?"))resetSession()});finishBtn.addEventListener("click",saveWorkout);
  $("#clear-history").addEventListener("click",()=>{if(confirm("Xóa toàn bộ lịch sử tập luyện trên thiết bị này?")){localStorage.removeItem(historyKey);renderHistory();renderStats()}});
  renderHistory();renderStats();
})();
