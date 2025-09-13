/*
 * AI健身助手 - 主脚本文件
 * 包含摄像头访问、姿态检测、动作识别和语音反馈功能
 */

// DOM元素引用 - 适配index.html的结构
const webcamElement = document.getElementById('webcam');
const overlayElement = document.getElementById('overlay');
const overlayCtx = overlayElement.getContext('2d');
const exerciseTypeSelect = document.getElementById('exercise-type');
const feedbackTextElement = document.getElementById('feedback-text');
const heroStartBtn = document.getElementById('hero-start-btn');
const muteIcon = document.getElementById('mute-icon');
const heroSection = document.querySelector('.hero-section');
const container = document.querySelector('.container');
const videoSection = document.querySelector('.video-section');
const closeFooterBtn = document.getElementById('close-footer-btn');
const footerInfo = document.querySelector('.footer-info');
const sidelineBtn = document.getElementById('sideline-btn');
const statusDisplay = document.querySelector('.status-display');
const videoContainer = document.querySelector('.video-container');

// 添加计数显示元素
const counterDiv = document.createElement('div');
counterDiv.className = 'counter';
counterDiv.innerHTML = '<span id="rep-count">次数: 0</span>';
// 先添加到DOM，但不立即显示
feedbackTextElement.parentNode.appendChild(counterDiv);
const repCountElement = document.getElementById('rep-count');

// 应用状态变量
let isRunning = false;
let isMuted = false;
let repCount = 0;
let pose = null;
let exerciseState = 'ready'; // ready, down, up
let lastFeedbackTime = 0;
const FEEDBACK_INTERVAL = 1500; // 语音反馈间隔（毫秒）

// 平板支撑计时相关变量
let plankStartTime = 0;
let plankTimerInterval = null;
let plankDuration = 0;
let plankReminderSent = false;
let plankTimerModalTimeout = null;



// 定义POINTS常量
const POSE_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 7],
    [0, 4], [4, 5], [5, 6], [6, 8],
    [9, 10],
    [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
    [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
    [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [27, 29], [28, 30], [29, 31], [30, 32]
];

// 自定义绘制连接线函数
function drawConnectors(ctx, landmarks, connections, style) {
    ctx.save();
    ctx.strokeStyle = style.color || '#000000';
    ctx.lineWidth = style.lineWidth || 2;
    
    connections.forEach((connection) => {
        const fromLandmark = landmarks[connection[0]];
        const toLandmark = landmarks[connection[1]];
        
        if (fromLandmark && toLandmark) {
            ctx.beginPath();
            ctx.moveTo(fromLandmark.x * ctx.canvas.width, fromLandmark.y * ctx.canvas.height);
            ctx.lineTo(toLandmark.x * ctx.canvas.width, toLandmark.y * ctx.canvas.height);
            ctx.stroke();
        }
    });
    
    ctx.restore();
}

// 自定义绘制关键点函数
function drawLandmarks(ctx, landmarks, style) {
    ctx.save();
    ctx.fillStyle = style.fillColor || '#000000';
    ctx.strokeStyle = style.color || '#ffffff';
    ctx.lineWidth = 1;
    
    const radius = style.radius || 5;
    
    landmarks.forEach((landmark) => {
        if (landmark) {
            const x = landmark.x * ctx.canvas.width;
            const y = landmark.y * ctx.canvas.height;
            
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
        }
    });
    
    ctx.restore();
}

// 计算两个点之间的距离
function calculateDistance(point1, point2) {
    const dx = point1.x - point2.x;
    const dy = point1.y - point2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// 计算三个点形成的角度
function calculateAngle(pointA, pointB, pointC) {
    // 检查点是否存在且有有效坐标
    if (!pointA || !pointB || !pointC || 
        typeof pointA.x !== 'number' || typeof pointA.y !== 'number' ||
        typeof pointB.x !== 'number' || typeof pointB.y !== 'number' ||
        typeof pointC.x !== 'number' || typeof pointC.y !== 'number') {
        return 0;
    }
    
    // 转换为笛卡尔坐标系（y轴向下为正）
    const x1 = pointA.x;
    const y1 = pointA.y;
    const x2 = pointB.x;
    const y2 = pointB.y;
    const x3 = pointC.x;
    const y3 = pointC.y;
    
    // 计算向量
    const v1x = x1 - x2;
    const v1y = y1 - y2;
    const v2x = x3 - x2;
    const v2y = y3 - y2;
    
    // 计算向量的点积
    const dotProduct = v1x * v2x + v1y * v2y;
    
    // 计算向量的模长
    const v1Length = Math.sqrt(v1x * v1x + v1y * v1y);
    const v2Length = Math.sqrt(v2x * v2x + v2y * v2y);
    
    // 防止除零错误
    if (v1Length === 0 || v2Length === 0) {
        return 0;
    }
    
    // 计算角度（弧度）
    // 确保余弦值在有效范围内，防止NaN
    const cosine = Math.max(-1, Math.min(1, dotProduct / (v1Length * v2Length)));
    let angle = Math.acos(cosine);
    
    // 转换为角度
    angle = angle * (180 / Math.PI);
    
    return angle;
}

// 姿态检测结果回调
function onPoseResults(results) {
    if (!isRunning || !results.poseLandmarks) return;

    // 清除上一帧的绘制
    overlayCtx.clearRect(0, 0, overlayElement.width, overlayElement.height);

    // 绘制姿态关键点和连接线
    drawConnectors(overlayCtx, results.poseLandmarks, POSE_CONNECTIONS, {
        color: '#00FF00',
        lineWidth: 2
    });
    drawLandmarks(overlayCtx, results.poseLandmarks, {
        color: '#FF0000',
        fillColor: '#00FF00',
        radius: 5
    });
    
    // 根据选择的动作类型进行分析
    const exerciseType = exerciseTypeSelect.value;
    
    switch (exerciseType) {
        case 'squat_front':
            analyzeSquatFront(results.poseLandmarks);
            break;
        case 'squat_side':
            analyzeSquatSide(results.poseLandmarks);
            break;
        case 'deadlift':
            analyzeDeadlift(results.poseLandmarks);
            break;
        case 'pushup':
            analyzePushup(results.poseLandmarks);
            break;
        case 'plank':
            analyzePlank(results.poseLandmarks);
            break;
    }
}

// 分析深蹲动作 - 传统版（默认）
// 分析深蹲动作 - 正面视角（只判定膝盖内扣）
function analyzeSquatFront(landmarks) {
    try {
        // 获取关键关节点
        const leftHip = landmarks[23];
        const rightHip = landmarks[24];
        const leftKnee = landmarks[25];
        const rightKnee = landmarks[26];
        const leftAnkle = landmarks[27];
        const rightAnkle = landmarks[28];
        
        // 计算膝盖角度（取左右膝盖的平均值）用于动作阶段分析
        const leftKneeAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
        const rightKneeAngle = calculateAngle(rightHip, rightKnee, rightAnkle);
        const kneeAngle = (leftKneeAngle + rightKneeAngle) / 2;
        
        // 分析动作阶段（保持与原深蹲相同的阶段判断逻辑）
        if (kneeAngle > 160 && exerciseState === 'up') {
            exerciseState = 'ready';
            showFeedback('准备就绪，请开始深蹲（正面视角 - 专注膝盖内扣）', 'info');
        } else if (kneeAngle < 90 && exerciseState === 'ready') {
            exerciseState = 'down';
            showFeedback('深蹲到位，准备起身', 'info');
        } else if (kneeAngle > 160 && exerciseState === 'down') {
            exerciseState = 'up';
            repCount++;
            repCountElement.textContent = `次数: ${repCount}`;
            // 更新底部计数器
            const bottomCounter = document.getElementById('bottom-counter');
            if (bottomCounter) {
                bottomCounter.querySelector('span').textContent = `次数: ${repCount}`;
            }
            showFeedback('完美！完成一次深蹲', 'success');
        }
        
        // 纠正动作 - 只检查膝盖是否内扣
        if (exerciseState !== 'ready') {
            // 检查膝盖是否内扣
            const kneeDistance = calculateDistance(leftKnee, rightKnee);
            const ankleDistance = calculateDistance(leftAnkle, rightAnkle);
            
            if (kneeDistance < ankleDistance * 1.3) {
                showFeedback('注意膝盖不要内扣', 'warning');
            }
        }
    } catch (error) {
        console.error('深蹲正面视角分析错误:', error);
    }
}

// 分析深蹲动作 - 侧面视角（只判定背部挺直）
function analyzeSquatSide(landmarks) {
    try {
        // 获取关键关节点
        const leftHip = landmarks[23];
        const rightHip = landmarks[24];
        const leftKnee = landmarks[25];
        const rightKnee = landmarks[26];
        const leftAnkle = landmarks[27];
        const rightAnkle = landmarks[28];
        
        // 计算膝盖角度（取左右膝盖的平均值）用于动作阶段分析
        const leftKneeAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
        const rightKneeAngle = calculateAngle(rightHip, rightKnee, rightAnkle);
        const kneeAngle = (leftKneeAngle + rightKneeAngle) / 2;
        
        // 分析动作阶段（保持与原深蹲相同的阶段判断逻辑）
        if (kneeAngle > 160 && exerciseState === 'up') {
            exerciseState = 'ready';
            showFeedback('准备就绪，请开始深蹲（侧面视角 - 专注背部挺直）', 'info');
        } else if (kneeAngle < 90 && exerciseState === 'ready') {
            exerciseState = 'down';
            showFeedback('深蹲到位，准备起身', 'info');
        } else if (kneeAngle > 160 && exerciseState === 'down') {
            exerciseState = 'up';
            repCount++;
            repCountElement.textContent = `次数: ${repCount}`;
            // 更新底部计数器
            const bottomCounter = document.getElementById('bottom-counter');
            if (bottomCounter) {
                bottomCounter.querySelector('span').textContent = `次数: ${repCount}`;
            }
            showFeedback('完美！完成一次深蹲', 'success');
        }
        
        // 纠正动作 - 只检查背部是否保持挺直
        if (exerciseState !== 'ready') {
            // 检查背部是否保持挺直
            const leftShoulder = landmarks[11];
            const spineAngle = calculateAngle(leftShoulder, leftHip, leftKnee);
            
            if (spineAngle < 110) {
                showFeedback('保持背部挺直', 'warning');
            }
        }
    } catch (error) {
        console.error('深蹲侧面视角分析错误:', error);
    }
}

// 分析硬拉动作
function analyzeDeadlift(landmarks) {
    try {
        // 获取关键关节点
        const leftShoulder = landmarks[11];
        const rightShoulder = landmarks[12];
        const leftHip = landmarks[23];
        const rightHip = landmarks[24];
        const leftKnee = landmarks[25];
        const rightKnee = landmarks[26];
        
        // 计算髋部和膝盖角度
        const leftHipAngle = calculateAngle(leftShoulder, leftHip, leftKnee);
        const rightHipAngle = calculateAngle(rightShoulder, rightHip, rightKnee);
        const hipAngle = (leftHipAngle + rightHipAngle) / 2;
        
        // 分析动作阶段
        if (hipAngle > 160 && exerciseState === 'up') {
            exerciseState = 'ready';
            showFeedback('准备就绪，请开始硬拉', 'info');
        } else if (hipAngle < 90 && exerciseState === 'ready') {
            exerciseState = 'down';
            showFeedback('准备拉起', 'info');
        } else if (hipAngle > 160 && exerciseState === 'down') {
            exerciseState = 'up';
            repCount++;
            repCountElement.textContent = `次数: ${repCount}`;
            // 更新底部计数器
            const bottomCounter = document.getElementById('bottom-counter');
            if (bottomCounter) {
                bottomCounter.querySelector('span').textContent = `次数: ${repCount}`;
            }
            showFeedback('完美！完成一次硬拉', 'success');
        }
        
        // 纠正动作
        if (exerciseState !== 'ready') {
            // 检查背部是否保持挺直
            const nose = landmarks[0];
            const midHip = {
                x: (leftHip.x + rightHip.x) / 2,
                y: (leftHip.y + rightHip.y) / 2
            };
            
            const spineTilt = Math.abs(nose.x - midHip.x);
            
            if (spineTilt > 0.05) {
                showFeedback('保持背部中立，不要过度前倾或后仰', 'warning');
            }
            
            // 检查膝盖是否锁定
            if (exerciseState === 'up' && hipAngle > 170) {
                showFeedback('完成动作时膝盖不要完全锁定', 'warning');
            }
        }
    } catch (error) {
        console.error('硬拉动作分析错误:', error);
    }
}

// 分析俯卧撑动作
function analyzePushup(landmarks) {
    try {
        // 获取关键关节点
        const leftShoulder = landmarks[11];
        const rightShoulder = landmarks[12];
        const leftElbow = landmarks[13];
        const rightElbow = landmarks[14];
        const leftWrist = landmarks[15];
        const rightWrist = landmarks[16];
        
        // 计算肘部角度（取左右肘部的平均值）
        const leftElbowAngle = calculateAngle(leftShoulder, leftElbow, leftWrist);
        const rightElbowAngle = calculateAngle(rightShoulder, rightElbow, rightWrist);
        const elbowAngle = (leftElbowAngle + rightElbowAngle) / 2;
        
        // 分析动作阶段
        if (elbowAngle > 160 && exerciseState === 'up') {
            exerciseState = 'ready';
            showFeedback('准备就绪，请开始俯卧撑', 'info');
        } else if (elbowAngle < 90 && exerciseState === 'ready') {
            exerciseState = 'down';
            showFeedback('俯卧撑到位，准备撑起', 'info');
        } else if (elbowAngle > 160 && exerciseState === 'down') {
            exerciseState = 'up';
            repCount++;
            repCountElement.textContent = `次数: ${repCount}`;
            // 更新底部计数器
            const bottomCounter = document.getElementById('bottom-counter');
            if (bottomCounter) {
                bottomCounter.querySelector('span').textContent = `次数: ${repCount}`;
            }
            showFeedback('完美！完成一次俯卧撑', 'success');
        }
        
        // 纠正动作
        if (exerciseState !== 'ready') {
            // 检查身体是否保持直线
            const leftHip = landmarks[23];
            const rightHip = landmarks[24];
            const leftAnkle = landmarks[27];
            const rightAnkle = landmarks[28];
            
            const midShoulder = {
                x: (leftShoulder.x + rightShoulder.x) / 2,
                y: (leftShoulder.y + rightShoulder.y) / 2
            };
            const midHip = {
                x: (leftHip.x + rightHip.x) / 2,
                y: (leftHip.y + rightHip.y) / 2
            };
            const midAnkle = {
                x: (leftAnkle.x + rightAnkle.x) / 2,
                y: (leftAnkle.y + rightAnkle.y) / 2
            };
            
            // 检查臀部是否抬起或下沉
            const bodyStraightness = Math.abs((midHip.y - midShoulder.y) - (midAnkle.y - midHip.y));
            
            if (bodyStraightness > 0.1) {
                showFeedback('保持身体呈直线，不要塌腰或撅臀', 'warning');
            }
            
            // 检查手肘是否向外展开过大
            if (elbowAngle < 70) {
                showFeedback('手肘不要向外展开过大', 'warning');
            }
        }
    } catch (error) {
        console.error('俯卧撑动作分析错误:', error);
    }
}

// 分析平板支撑动作
function analyzePlank(landmarks) {
    try {
        // 获取关键关节点
        const leftShoulder = landmarks[11];
        const rightShoulder = landmarks[12];
        const leftElbow = landmarks[13];
        const rightElbow = landmarks[14];
        const leftHip = landmarks[23];
        const rightHip = landmarks[24];
        const leftKnee = landmarks[25];
        const rightKnee = landmarks[26];
        
        // 计算身体直线度
        const midShoulder = {
            x: (leftShoulder.x + rightShoulder.x) / 2,
            y: (leftShoulder.y + rightShoulder.y) / 2
        };
        const midHip = {
            x: (leftHip.x + rightHip.x) / 2,
            y: (leftHip.y + rightHip.y) / 2
        };
        const midKnee = {
            x: (leftKnee.x + rightKnee.x) / 2,
            y: (leftKnee.y + rightKnee.y) / 2
        };
        
        // 检查身体是否保持直线（调整判定阈值，更加严格）
        const bodyStraightness = Math.abs((midHip.y - midShoulder.y) - (midKnee.y - midHip.y));
        
        // 检查手肘角度
        const leftElbowAngle = calculateAngle(leftShoulder, leftElbow, leftHip);
        const rightElbowAngle = calculateAngle(rightShoulder, rightElbow, rightHip);
        const elbowAngle = (leftElbowAngle + rightElbowAngle) / 2;
        
        // 判断是否处于标准平板支撑姿势
        const isInPlankPosition = 
            bodyStraightness < 0.05 && 
            elbowAngle >= 80 && elbowAngle <= 100;
        
        // 平板支撑是保持姿势的动作，持续给予反馈
        if (isInPlankPosition) {
            showFeedback('姿势很棒！保持住', 'success');
        } else if (midHip.y < midShoulder.y * 0.95) {
            showFeedback('臀部不要抬太高', 'warning');
        } else if (midHip.y > midShoulder.y * 1.05) {
            showFeedback('注意不要塌腰', 'warning');
        } else if (elbowAngle < 80 || elbowAngle > 100) {
            showFeedback('手肘保持90度，位于肩膀正下方', 'warning');
        }
        
        // 检查头部姿态
        const nose = landmarks[0];
        if (nose.y < midShoulder.y * 0.9) {
            showFeedback('不要抬头，保持颈部中立', 'warning');
        } else if (nose.y > midShoulder.y * 1.1) {
            showFeedback('不要低头，保持颈部中立', 'warning');
        }
    } catch (error) {
        console.error('平板支撑动作分析错误:', error);
    }
}

// 语音反馈函数
function speak(text) {
    if (isMuted) return;
    
    // 停止任何正在进行的语音
    window.speechSynthesis.cancel();
    
    // 创建语音实例
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.volume = 1;
    utterance.rate = 1;
    utterance.pitch = 1;
    
    // 播放语音
    window.speechSynthesis.speak(utterance);
}

// 全局变量：是否可以开始纠正动作的语音
let canCorrectMotion = false;

// 显示反馈信息
function showFeedback(text, type = 'info') {
    feedbackTextElement.textContent = text;
    
    // 根据类型设置不同的颜色
    switch (type) {
        case 'success':
            feedbackTextElement.style.color = '#28a745';
            break;
        case 'warning':
            feedbackTextElement.style.color = '#ffc107';
            break;
        case 'error':
            feedbackTextElement.style.color = '#dc3545';
            break;
        default:
            feedbackTextElement.style.color = '#6c757d';
    }
    
    // 语音反馈（如果未静音且不在间隔期内，并且可以开始纠正动作的语音）
    const now = Date.now();
    if (!isMuted && now - lastFeedbackTime > FEEDBACK_INTERVAL && (canCorrectMotion || type === 'info')) {
        speak(text);
        lastFeedbackTime = now;
    }
}

// 格式化时间显示
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 更新平板支撑计时器显示
function updatePlankTimer() {
    if (!plankTimerElement) {
        // 确保计时器元素存在
        plankTimerElement = document.getElementById('plank-timer-display');
        if (!plankTimerElement) return;
    }
    
    plankDuration = Math.floor((Date.now() - plankStartTime) / 1000);
    plankTimerElement.textContent = `时长: ${formatTime(plankDuration)}`;
    
    // 检查是否需要显示30秒提醒
    checkPlankReminder();
}

// 检查平板支撑30秒提醒
function checkPlankReminder() {
    if (plankDuration >= 30 && !plankReminderSent) {
        plankReminderSent = true;
        showPlankTimerModal();
        
        if (!isMuted) {
            speak('已经坚持30秒了，继续加油！');
        }
    }
}

// 显示平板支撑计时提醒弹窗
function showPlankTimerModal() {
    const modal = document.getElementById('plank-timer-modal');
    if (modal) {
        modal.style.display = 'flex';
        
        // 3秒后自动关闭弹窗
        clearTimeout(plankTimerModalTimeout);
        plankTimerModalTimeout = setTimeout(() => {
            hidePlankTimerModal();
        }, 3000);
    }
}

// 隐藏平板支撑计时提醒弹窗
function hidePlankTimerModal() {
    // 隐藏计时器容器
    const timerContainer = document.getElementById('plank-timer-container');
    if (timerContainer) {
        timerContainer.style.display = 'none';
    }
    
    // 隐藏计时器模态框（如果存在）
    const modal = document.getElementById('plank-timer-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 开始平板支撑计时器
function startPlankTimer() {
    plankStartTime = Date.now();
    plankReminderSent = false;
    
    // 创建计时器元素（如果不存在）
    if (!document.getElementById('plank-timer-container')) {
        const timerContainer = document.createElement('div');
        timerContainer.id = 'plank-timer-container';
        timerContainer.className = 'plank-timer-modal';
        timerContainer.innerHTML = '<span id="plank-timer-display">时长: 00:00</span>';
        document.body.appendChild(timerContainer);
        plankTimerElement = document.getElementById('plank-timer-display');
    } else {
        plankTimerElement = document.getElementById('plank-timer-display');
        document.getElementById('plank-timer-container').style.display = 'flex';
    }
    
    // 启动计时器更新
    if (plankTimerInterval) {
        clearInterval(plankTimerInterval);
    }
    plankTimerInterval = setInterval(updatePlankTimer, 1000);
    updatePlankTimer(); // 立即更新一次
    
    // 隐藏计数器，显示计时器
    hideCounter();
}

// 隐藏计数器（用于平板支撑模式）
function hideCounter() {
    const bottomCounter = document.getElementById('bottom-counter');
    if (bottomCounter) {
        bottomCounter.style.display = 'none';
    }
    counterDiv.style.display = 'none';
}

// 停止平板支撑计时器
function stopPlankTimer() {
    if (plankTimerInterval) {
        clearInterval(plankTimerInterval);
        plankTimerInterval = null;
    }
    
    clearTimeout(plankTimerModalTimeout);
    
    // 确保计时器完全隐藏
    const timerContainer = document.getElementById('plank-timer-container');
    if (timerContainer) {
        timerContainer.style.display = 'none';
    }
    
    const modal = document.getElementById('plank-timer-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 重置平板支撑计时器
function resetPlankTimer() {
    stopPlankTimer();
    plankDuration = 0;
    plankReminderSent = false;
    
    if (plankTimerElement) {
        plankTimerElement.textContent = '时长: 00:00';
    }
}

// 初始化MediaPipe Pose
async function initPose() {
    try {
        pose = new Pose({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`;
            }
        });

        // 配置Pose参数 - 降低阈值提高检测灵敏度
        pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            enableSegmentation: false,
            smoothSegmentation: true,
            minDetectionConfidence: 0.3, // 降低检测置信度阈值
            minTrackingConfidence: 0.3   // 降低跟踪置信度阈值
        });

        // 设置结果回调
        pose.onResults(onPoseResults);
    } catch (error) {
        console.error('初始化Pose失败:', error);
        showFeedback('初始化失败，请刷新页面重试', 'error');
    }
}

// 访问用户摄像头
async function setupWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            }
        });

        webcamElement.srcObject = stream;

        // 调整canvas大小以匹配视频
        return new Promise((resolve) => {
            webcamElement.onloadedmetadata = () => {
                overlayElement.width = webcamElement.videoWidth;
                overlayElement.height = webcamElement.videoHeight;
                resolve(webcamElement);
            };
        });
    } catch (error) {
        console.error('访问摄像头失败:', error);
        showFeedback('无法访问摄像头，请检查权限设置', 'error');
        throw error;
    }
}

// 开始训练
async function startTraining() {
    try {
        // 显示训练界面
        heroSection.classList.add('training');
        container.style.display = 'block';
        
        // 重置状态
        repCount = 0;
        repCountElement.textContent = `次数: ${repCount}`;
        exerciseState = 'ready';
        isRunning = true;
        
        // 隐藏开始训练按钮并显示停止训练按钮
        heroStartBtn.style.display = 'none';
        
        // 创建并显示停止按钮
        const startTrainingContainer = document.querySelector('.start-training-container');
        if (!document.getElementById('stop-training-btn')) {
            const stopBtn = document.createElement('button');
            stopBtn.id = 'stop-training-btn';
            stopBtn.className = 'stop-training-btn';
            stopBtn.textContent = '停止训练';
            stopBtn.addEventListener('click', stopTraining);
            startTrainingContainer.appendChild(stopBtn);
        } else {
            document.getElementById('stop-training-btn').style.display = 'block';
        }
        
        // 移动实时视频到YouTube视频的位置并居中显示
        videoSection.style.position = 'absolute';
        videoSection.style.top = '50%';
        videoSection.style.left = '50%';
        videoSection.style.transform = 'translate(-50%, -50%)';
        videoSection.style.zIndex = '3';
        
        // 确保视频容器居中并适应屏幕
        videoContainer.style.maxWidth = '80vw';
        videoContainer.style.maxHeight = '80vh';
        
        // 调整准备就绪显示在视频上方
        const controlsSection = document.querySelector('.controls-section');
        controlsSection.style.position = 'absolute';
        controlsSection.style.width = '100%';
        controlsSection.style.top = '10%';
        controlsSection.style.zIndex = '4';
        controlsSection.style.display = 'flex';
        controlsSection.style.flexDirection = 'column';
        controlsSection.style.alignItems = 'center';
        controlsSection.style.backgroundColor = 'transparent';
        controlsSection.style.boxShadow = 'none';
        
        // 调整状态显示和计数器的位置
        statusDisplay.style.width = '80vw';
        statusDisplay.style.maxWidth = '800px';
        statusDisplay.style.justifyContent = 'flex-start'; // 改为左对齐
        statusDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        statusDisplay.style.color = 'white';
        statusDisplay.style.padding = '15px';
        statusDisplay.style.position = 'absolute'; // 添加绝对定位
        statusDisplay.style.left = '25%'; // 向左移动到1/2的位置
        
        // 调整反馈文本样式
        feedbackTextElement.style.color = 'white';
        
        // 隐藏原始的计数器，准备在视频下方显示
        counterDiv.style.display = 'none';
        
        // 创建停止训练按钮下方的计数器
        if (!document.getElementById('bottom-counter')) {
            const bottomCounter = document.createElement('div');
            bottomCounter.id = 'bottom-counter';
            bottomCounter.className = 'counter';
            bottomCounter.innerHTML = `<span>${repCountElement.innerHTML}</span>`;
            bottomCounter.style.marginTop = '10px';
            bottomCounter.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
            bottomCounter.style.padding = '15px 25px';
            bottomCounter.style.borderRadius = '5px';
            bottomCounter.style.color = 'white';
            bottomCounter.style.zIndex = '4';
            bottomCounter.style.display = 'block';
            bottomCounter.style.textAlign = 'center';
            startTrainingContainer.appendChild(bottomCounter);
        } else {
            const bottomCounter = document.getElementById('bottom-counter');
            bottomCounter.querySelector('span').innerHTML = repCountElement.innerHTML;
            bottomCounter.style.display = 'block';
        }
        
        // 对于平板支撑，立即开始计时
        if (exerciseTypeSelect.value === 'plank') {
            startPlankTimer();
        }
        
        // 隐藏底部说明部分
        footerInfo.classList.remove('visible');
        
        // 隐藏按钮区域
        const buttons = document.querySelector('.buttons');
        buttons.style.display = 'none';
        
        // 初始化姿态检测
        if (!pose) {
            await initPose();
        }
        
        // 设置摄像头 - 处理设备占用情况
        try {
            const webcam = await setupWebcam();
        } catch (error) {
            console.warn('摄像头可能被其他应用占用，将继续使用模拟模式', error);
            showFeedback('摄像头可能被占用，将使用模拟模式', 'warning');
            // 继续执行，使用模拟模式
        }
        
        // 开始处理视频流
        async function processVideo() {
            if (!isRunning) return;
            
            try {
                // 使用正确的视频源
                const videoElement = document.getElementById('webcam');
                if (videoElement && videoElement.srcObject) {
                    await pose.send({
                        image: videoElement
                    });
                } else {
                    showFeedback('视频源错误，请刷新页面重试', 'error');
                }
                requestAnimationFrame(processVideo);
            } catch (error) {
                console.error('处理视频流错误:', error);
                if (isRunning) {
                    requestAnimationFrame(processVideo);
                }
            }
        }
        
        // 播放欢迎语音
        canCorrectMotion = false;
        const welcomeText = 'StartFitter已就绪，随时可以开始训练';
        feedbackTextElement.textContent = welcomeText;
        feedbackTextElement.style.color = '#6c757d';
        speak(welcomeText);
        
        // 延迟开始处理视频流，确保欢迎语音播放完毕
        setTimeout(() => {
            canCorrectMotion = true;
            processVideo();
        }, 3000);
    } catch (error) {
        console.error('开始训练失败:', error);
        showFeedback('开始训练失败，请重试', 'error');
        // 重置按钮状态
        heroStartBtn.disabled = false;
        heroStartBtn.textContent = '开始训练';
    }
}

// 停止训练
function stopTraining() {
    isRunning = false;
    
    // 停止平板支撑计时器
    stopPlankTimer();
    
    // 更新按钮状态
    heroStartBtn.disabled = false;
    heroStartBtn.textContent = '开始训练';
    heroStartBtn.style.display = 'block';
    
    // 隐藏停止训练按钮
    const stopTrainingBtn = document.getElementById('stop-training-btn');
    if (stopTrainingBtn) {
        stopTrainingBtn.style.display = 'none';
    }
    
    // 隐藏训练界面
    heroSection.classList.remove('training');
    container.style.display = 'none';
    
    // 恢复视频区域的原始位置和样式
    videoSection.style.position = '';
    videoSection.style.top = '';
    videoSection.style.left = '';
    videoSection.style.transform = '';
    videoSection.style.zIndex = '';
    
    // 恢复视频容器的原始样式
    videoContainer.style.maxWidth = '';
    videoContainer.style.maxHeight = '';
    
    // 恢复控件区域的原始样式
    const controlsSection = document.querySelector('.controls-section');
    controlsSection.style.position = '';
    controlsSection.style.width = '';
    controlsSection.style.top = '';
    controlsSection.style.zIndex = '';
    controlsSection.style.display = '';
    controlsSection.style.flexDirection = '';
    controlsSection.style.alignItems = '';
    controlsSection.style.backgroundColor = '';
    controlsSection.style.boxShadow = '';
    
    // 恢复状态显示的原始样式
    statusDisplay.style.width = '';
    statusDisplay.style.maxWidth = '';
    statusDisplay.style.justifyContent = '';
    statusDisplay.style.backgroundColor = '';
    statusDisplay.style.color = '';
    statusDisplay.style.padding = '';
    
    // 恢复反馈文本的原始样式
    feedbackTextElement.style.color = '';
    
    // 显示原始的计数器
    counterDiv.style.display = 'block';
    
    // 隐藏底部计数器
    const bottomCounter = document.getElementById('bottom-counter');
    if (bottomCounter) {
        bottomCounter.style.display = 'none';
    }
    
    // 显示按钮区域
    const buttons = document.querySelector('.buttons');
    buttons.style.display = '';
    
    // 移除可能存在的旧版停止按钮
    const oldStopBtn = document.getElementById('stop-btn');
    if (oldStopBtn) {
        oldStopBtn.remove();
    }
    
    // 停止语音
    window.speechSynthesis.cancel();
    
    // 清除视频流
    if (webcamElement.srcObject) {
        webcamElement.srcObject.getTracks().forEach(track => track.stop());
        webcamElement.srcObject = null;
    }
    
    // 清除canvas
    overlayCtx.clearRect(0, 0, overlayElement.width, overlayElement.height);
    
    showFeedback('训练已停止', 'info');
}

// 切换静音状态
function toggleMute() {
    isMuted = !isMuted;
    const svg = muteIcon.querySelector('svg');
    if (isMuted) {
        // 更改图标为静音状态
        svg.innerHTML = '<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3.04-2.46 5.5-5.5 5.5s-5.5-2.46-5.5-5.5H5c0 3.53 2.61 6.43 6 6.92V21h2v-4.08c3.39-.49 6-3.39 6-6.92h-1.7z"/>';
        showFeedback('语音反馈已关闭', 'info');
    } else {
        // 恢复图标为正常状态
        svg.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
        showFeedback('语音反馈已开启', 'info');
    }
}

// 切换动作类型时重置状态
function onExerciseTypeChange() {
    if (isRunning) {
        repCount = 0;
        repCountElement.textContent = `次数: ${repCount}`;
        exerciseState = 'ready';
    }
    
    // 处理计时器逻辑 - 无论训练是否正在进行，都需要处理
    const prevType = this.previousValue || '';
    const newType = exerciseTypeSelect.value;
    
    // 停止之前的计时器（无论之前是什么动作类型，都先隐藏计时器）
    stopPlankTimer();
    
    // 启动新的计时器
    if (newType === 'plank') {
        // 在切换到平板支撑时立即开始计时
        startPlankTimer();
    } else {
        // 对于非平板支撑动作，显示计数器并确保计时器隐藏
        const bottomCounter = document.getElementById('bottom-counter');
        if (bottomCounter && isRunning) {
            bottomCounter.style.display = 'block';
        }
        if (isRunning) {
            counterDiv.style.display = 'block';
        }
        
        // 额外确保计时器隐藏
        const timerModal = document.getElementById('plank-timer-container');
        if (timerModal) {
            timerModal.style.display = 'none';
        }
    }
    
    // 存储当前值以便下次比较
    this.previousValue = newType;
    
    showFeedback(`已切换到${exerciseTypeSelect.options[exerciseTypeSelect.selectedIndex].text}训练`, 'info');
}

// 注册事件监听器
heroStartBtn.addEventListener('click', startTraining);
muteIcon.addEventListener('click', toggleMute);
exerciseTypeSelect.addEventListener('change', onExerciseTypeChange);
// 添加sideline按钮事件监听器
sidelineBtn.addEventListener('click', function() {
    // 切换底部说明部分的显示/隐藏
    if (heroSection.classList.contains('training')) {
        footerInfo.classList.toggle('visible');
    }
});

// 关闭底部说明
closeFooterBtn.addEventListener('click', function() {
    footerInfo.style.transform = 'translateY(100%)';
    // 显示开始训练按钮
    if (heroStartBtn) {
        heroStartBtn.style.display = 'block';
    }
});

// 初始化应用
function initApp() {
    showFeedback('Hi, I\'m StartFitter. 选择你的动作并开始训练吧。', 'info');
    
    // 默认隐藏开始训练按钮
    if (heroStartBtn) {
        heroStartBtn.style.display = 'none';
    }
    
    // 初始化平板支撑计时器相关元素
    if (document.getElementById('plank-timer-modal')) {
        // 添加弹窗关闭按钮事件
        const closeTimerModalBtn = document.getElementById('close-timer-modal-btn');
        if (closeTimerModalBtn) {
            closeTimerModalBtn.addEventListener('click', hidePlankTimerModal);
        }
        
        // 点击弹窗外部关闭弹窗
        const modal = document.getElementById('plank-timer-modal');
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                hidePlankTimerModal();
            }
        });
    }
    
    // 初始化计数弹窗
    if (document.getElementById('count-modal')) {
        const closeModalBtn = document.getElementById('close-modal-btn');
        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', function() {
                const countModal = document.getElementById('count-modal');
                if (countModal) {
                    countModal.style.display = 'none';
                }
            });
        }
        
        // 点击弹窗外部关闭弹窗
        const countModal = document.getElementById('count-modal');
        countModal.addEventListener('click', function(e) {
            if (e.target === countModal) {
                countModal.style.display = 'none';
            }
        });
    }
}

// 页面加载完成后初始化应用
window.addEventListener('load', initApp);