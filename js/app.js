/**
 * Shipment Error Prevention System MVP - App Logic
 * Designed for mobile offline-first PWA operation.
 */

// Application State
const state = {
    employeeId: null,
    currentScanType: null, // 'employee', 'delivery', 'item', 'process'
    scans: {
        delivery: { raw: '', parsed: null },
        item: { raw: '', parsed: null },
        process: { raw: '', parsed: null }
    },
    history: [],
    videoStream: null,
    scanIntervalId: null
};

// Audio context for dynamic sounds (Web Audio API)
let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

// Sound Synthesis using Web Audio API
function playSound(type) {
    try {
        initAudio();
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        const now = audioCtx.currentTime;
        
        if (type === 'ok') {
            // High-pitched pleasant dual-tone chime
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now); // A5
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
            
            osc.start(now);
            osc.stop(now + 0.4);
            
            // Second tone slightly offset
            setTimeout(() => {
                const osc2 = audioCtx.createOscillator();
                const gain2 = audioCtx.createGain();
                osc2.connect(gain2);
                gain2.connect(audioCtx.destination);
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(1109.73, audioCtx.currentTime); // C#6
                gain2.gain.setValueAtTime(0, audioCtx.currentTime);
                gain2.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
                gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
                osc2.start();
                osc2.stop(audioCtx.currentTime + 0.4);
            }, 80);
            
        } else if (type === 'ng') {
            // Low-pitched warning buzzer tone
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(120, now);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.5, now + 0.05);
            gain.gain.setValueAtTime(0.5, now + 0.15);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.5);
            
            osc.start(now);
            osc.stop(now + 0.5);
            
            // Vibrate pattern if supported
            if (navigator.vibrate) {
                navigator.vibrate([200, 100, 200, 100, 300]);
            }
        } else if (type === 'scan') {
            // Simple tick sound for scan registration
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1500, now);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
            
            osc.start(now);
            osc.stop(now + 0.1);
            
            if (navigator.vibrate) {
                navigator.vibrate(50);
            }
        }
    } catch (e) {
        console.warn('Audio feedback failed or not supported:', e);
    }
}

// Load and render history from LocalStorage
function loadHistory() {
    const data = localStorage.getItem('shipment_history');
    state.history = data ? JSON.parse(data) : [];
    renderHistoryTable();
}

function saveToHistory(record) {
    state.history.unshift(record); // Add to beginning
    // Limit to last 100 records
    if (state.history.length > 100) {
        state.history.pop();
    }
    localStorage.setItem('shipment_history', JSON.stringify(state.history));
    renderHistoryTable();
}

function clearHistory() {
    if (confirm('履歴をすべて削除してもよろしいですか？')) {
        state.history = [];
        localStorage.removeItem('shipment_history');
        renderHistoryTable();
    }
}

// Convert history to CSV and trigger download
function exportHistoryToCSV() {
    if (state.history.length === 0) {
        alert('出力する履歴データがありません。');
        return;
    }
    
    // CSV headers (UTF-8 with BOM for Excel compatibility)
    let csvContent = '\uFEFF';
    csvContent += '日時,判定,作業員,納品書品番,現品票品番,工程流動表品番,次区,納期,数量,注文番号,ロット番号\r\n';
    
    state.history.forEach(item => {
        const row = [
            item.timestamp,
            item.result,
            item.employeeId,
            item.deliveryPart,
            item.itemPart,
            item.processPart,
            item.nextArea || '',
            item.deliveryDate || '',
            item.quantity || '',
            item.orderNo || '',
            item.lotNo || ''
        ].map(val => `"${(val + '').replace(/"/g, '""')}"`).join(',');
        csvContent += row + '\r\n';
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `出荷検品履歴_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Parse logic for the QR types
function parseDeliveryNoteQR(rawStr) {
    if (!rawStr) return null;
    
    // Fixed length check helper (just warning, we proceed as best as we can)
    const isShort = rawStr.length < 212;
    
    // Slices are 1-based index (translated to 0-based in code)
    // 品番 127-136 -> substring(126, 136)
    // 次区 156-159 -> substring(155, 159)
    // 納期 180-187 -> substring(179, 187)
    // 数量 192-197 -> substring(191, 197)
    // 注文番号 204-212 -> substring(203, 212)
    
    return {
        partNo: rawStr.length >= 136 ? rawStr.substring(126, 136).trim() : rawStr.substring(126).trim(),
        nextArea: rawStr.length >= 159 ? rawStr.substring(155, 159).trim() : '',
        deliveryDate: rawStr.length >= 187 ? rawStr.substring(179, 187).trim() : '',
        quantity: rawStr.length >= 197 ? rawStr.substring(191, 197).trim() : '',
        orderNo: rawStr.length >= 212 ? rawStr.substring(203, 212).trim() : '',
        rawLength: rawStr.length,
        isShort: isShort
    };
}

function parseItemTagQR(rawStr) {
    if (!rawStr) return null;
    // 10桁を客先品番として取得
    return {
        partNo: rawStr.substring(0, 10).trim(),
        raw: rawStr
    };
}

function parseProcessRoutingQR(rawStr) {
    if (!rawStr) return null;
    // 先頭10桁を客先品番、残りをロット番号として取得
    return {
        partNo: rawStr.substring(0, 10).trim(),
        lotNo: rawStr.length > 10 ? rawStr.substring(10).trim() : '',
        raw: rawStr
    };
}

// Execute scanning of the camera stream using jsQR
function startCamera(scanType) {
    state.currentScanType = scanType;
    initAudio(); // Initialize audio context on user interaction
    
    const scannerModal = new bootstrap.Modal(document.getElementById('scannerModal'));
    const modalTitle = document.getElementById('scannerModalLabel');
    
    const titles = {
        employee: '社員証 QRコード読取',
        delivery: '客先納品書 QRコード読取',
        item: '現品票 QRコード読取',
        process: '工程流動表 QRコード読取'
    };
    modalTitle.textContent = titles[scanType] || 'QRコードスキャン';
    
    // Show modal and start stream
    scannerModal.show();
    
    const video = document.getElementById('scanner-video');
    const loadingText = document.getElementById('scanner-loading');
    
    loadingText.classList.remove('d-none');
    
    // Access user camera
    navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    })
    .then(stream => {
        state.videoStream = stream;
        video.srcObject = stream;
        video.setAttribute('playsinline', true); // Required for iOS
        video.play();
        
        loadingText.classList.add('d-none');
        
        // Start processing frames
        startScanLoop(video);
    })
    .catch(err => {
        console.error('Camera access error:', err);
        loadingText.innerHTML = `<span class="text-danger">カメラの起動に失敗しました。<br>権限を確認してください。</span>`;
    });
}

function stopCamera() {
    if (state.scanIntervalId) {
        clearInterval(state.scanIntervalId);
        state.scanIntervalId = null;
    }
    if (state.videoStream) {
        state.videoStream.getTracks().forEach(track => track.stop());
        state.videoStream = null;
    }
    const video = document.getElementById('scanner-video');
    if (video) video.srcObject = null;
}

function startScanLoop(video) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    state.scanIntervalId = setInterval(() => {
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            // jsQR is a global library loaded from CDN/local
            if (typeof jsQR !== 'undefined') {
                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: 'dontInvert',
                });
                
                if (code && code.data) {
                    // Successfully scanned a code!
                    handleScannedCode(code.data);
                }
            }
        }
    }, 200); // Check 5 times per second
}

function handleScannedCode(rawData) {
    // Sound feedback
    playSound('scan');
    
    // Stop scanning
    stopCamera();
    
    // Close modal
    const modalEl = document.getElementById('scannerModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
    
    processCodeData(state.currentScanType, rawData);
}

// Process the scanned string based on target slot
function processCodeData(type, rawData) {
    if (type === 'employee') {
        state.employeeId = rawData.trim();
        updateEmployeeUI();
    } else {
        if (type === 'delivery') {
            state.scans.delivery.raw = rawData;
            state.scans.delivery.parsed = parseDeliveryNoteQR(rawData);
        } else if (type === 'item') {
            state.scans.item.raw = rawData;
            state.scans.item.parsed = parseItemTagQR(rawData);
        } else if (type === 'process') {
            state.scans.process.raw = rawData;
            state.scans.process.parsed = parseProcessRoutingQR(rawData);
        }
        
        updateVerificationUI();
        checkComparison();
    }
}

// GUI Rendering and Updates
function updateEmployeeUI() {
    const section = document.getElementById('employee-section');
    const scannerSection = document.getElementById('scanner-main-section');
    const idDisplay = document.getElementById('active-employee-id');
    const inputField = document.getElementById('demo-employee-id');
    
    if (state.employeeId) {
        idDisplay.textContent = state.employeeId;
        section.classList.remove('border-danger');
        section.classList.add('border-success', 'bg-light');
        scannerSection.classList.remove('d-none');
        inputField.value = state.employeeId;
    } else {
        idDisplay.textContent = '未ログイン';
        section.classList.remove('border-success', 'bg-light');
        section.classList.add('border-danger');
        scannerSection.classList.add('d-none');
    }
}

function updateVerificationUI() {
    // 1. Delivery Note Slot
    const delSlot = document.getElementById('slot-delivery');
    const delData = state.scans.delivery;
    if (delData.raw) {
        delSlot.classList.add('scanned');
        delSlot.classList.remove('active');
        document.getElementById('del-status-badge').className = 'badge bg-success';
        document.getElementById('del-status-badge').textContent = '読取済';
        
        // Render fields
        document.getElementById('parsed-del-part').textContent = delData.parsed.partNo || '(空白)';
        document.getElementById('parsed-del-next').textContent = delData.parsed.nextArea || '(空白)';
        document.getElementById('parsed-del-date').textContent = delData.parsed.deliveryDate || '(空白)';
        document.getElementById('parsed-del-qty').textContent = delData.parsed.quantity || '(空白)';
        document.getElementById('parsed-del-order').textContent = delData.parsed.orderNo || '(空白)';
        document.getElementById('parsed-del-length').textContent = `${delData.parsed.rawLength}文字`;
        
        if (delData.parsed.isShort) {
            document.getElementById('parsed-del-length').className = 'parsed-val text-warning';
        } else {
            document.getElementById('parsed-del-length').className = 'parsed-val text-success';
        }
        
        document.getElementById('parsed-del-info').classList.remove('d-none');
        document.getElementById('demo-delivery-raw').value = delData.raw;
    } else {
        delSlot.classList.remove('scanned');
        delSlot.classList.add('active');
        document.getElementById('del-status-badge').className = 'badge bg-secondary';
        document.getElementById('del-status-badge').textContent = '未読取';
        document.getElementById('parsed-del-info').classList.add('d-none');
    }

    // 2. Item Tag Slot
    const itemSlot = document.getElementById('slot-item');
    const itemData = state.scans.item;
    if (itemData.raw) {
        itemSlot.classList.add('scanned');
        itemSlot.classList.remove('active');
        document.getElementById('item-status-badge').className = 'badge bg-success';
        document.getElementById('item-status-badge').textContent = '読取済';
        
        document.getElementById('parsed-item-part').textContent = itemData.parsed.partNo || '(空白)';
        document.getElementById('parsed-item-info').classList.remove('d-none');
        document.getElementById('demo-item-raw').value = itemData.raw;
    } else {
        itemSlot.classList.remove('scanned');
        itemSlot.classList.add('active');
        document.getElementById('item-status-badge').className = 'badge bg-secondary';
        document.getElementById('item-status-badge').textContent = '未読取';
        document.getElementById('parsed-item-info').classList.add('d-none');
    }

    // 3. Process Routing Slot
    const procSlot = document.getElementById('slot-process');
    const procData = state.scans.process;
    if (procData.raw) {
        procSlot.classList.add('scanned');
        procSlot.classList.remove('active');
        document.getElementById('proc-status-badge').className = 'badge bg-success';
        document.getElementById('proc-status-badge').textContent = '読取済';
        
        document.getElementById('parsed-proc-part').textContent = procData.parsed.partNo || '(空白)';
        document.getElementById('parsed-proc-lot').textContent = procData.parsed.lotNo || '(空白)';
        document.getElementById('parsed-proc-info').classList.remove('d-none');
        document.getElementById('demo-process-raw').value = procData.raw;
    } else {
        procSlot.classList.remove('scanned');
        procSlot.classList.add('active');
        document.getElementById('proc-status-badge').className = 'badge bg-secondary';
        document.getElementById('proc-status-badge').textContent = '未読取';
        document.getElementById('parsed-proc-info').classList.add('d-none');
    }
}

// Compare current scans and judge OK/NG
function checkComparison() {
    const delPart = state.scans.delivery.parsed?.partNo;
    const itemPart = state.scans.item.parsed?.partNo;
    const procPart = state.scans.process.parsed?.partNo;
    
    const bannerOk = document.getElementById('banner-ok');
    const bannerNg = document.getElementById('banner-ng');
    const detailsNg = document.getElementById('ng-mismatch-details');
    
    // Reset background and banners first
    document.body.className = '';
    bannerOk.classList.remove('status-ok');
    bannerNg.classList.remove('status-ng');
    detailsNg.classList.add('d-none');
    
    // We only judge when all three items have been scanned
    if (delPart && itemPart && procPart) {
        const isMatch = (delPart === itemPart) && (itemPart === procPart);
        
        const record = {
            timestamp: new Date().toLocaleString('ja-JP'),
            employeeId: state.employeeId || '未設定',
            deliveryPart: delPart,
            itemPart: itemPart,
            processPart: procPart,
            nextArea: state.scans.delivery.parsed.nextArea,
            deliveryDate: state.scans.delivery.parsed.deliveryDate,
            quantity: state.scans.delivery.parsed.quantity,
            orderNo: state.scans.delivery.parsed.orderNo,
            lotNo: state.scans.process.parsed.lotNo,
            result: isMatch ? 'OK' : 'NG'
        };
        
        if (isMatch) {
            // OK State
            document.body.className = 'bg-ok-active';
            bannerOk.classList.add('status-ok');
            playSound('ok');
        } else {
            // NG State
            document.body.className = 'bg-ng-active';
            bannerNg.classList.add('status-ng');
            
            // Build comparative feedback to show what went wrong
            let errorText = '不一致箇所:<br>';
            if (delPart !== itemPart) {
                errorText += `・納品書品番 (${delPart}) ≠ 現品票品番 (${itemPart})<br>`;
            }
            if (itemPart !== procPart) {
                errorText += `・現品票品番 (${itemPart}) ≠ 工程流動表品番 (${procPart})<br>`;
            }
            if (delPart !== procPart && delPart === itemPart) {
                errorText += `・納品書品番 (${delPart}) ≠ 工程流動表品番 (${procPart})<br>`;
            }
            
            detailsNg.innerHTML = errorText;
            detailsNg.classList.remove('d-none');
            playSound('ng');
        }
        
        // Auto save to LocalStorage history log
        saveToHistory(record);
    }
}

// Clear all scanned data from the current verification buffer
function resetCurrentScans() {
    state.scans.delivery = { raw: '', parsed: null };
    state.scans.item = { raw: '', parsed: null };
    state.scans.process = { raw: '', parsed: null };
    
    document.body.className = '';
    document.getElementById('banner-ok').classList.remove('status-ok');
    document.getElementById('banner-ng').classList.remove('status-ng');
    document.getElementById('ng-mismatch-details').classList.add('d-none');
    
    updateVerificationUI();
}

// Render history list
function renderHistoryTable() {
    const listContainer = document.getElementById('history-list');
    listContainer.innerHTML = '';
    
    if (state.history.length === 0) {
        listContainer.innerHTML = `<div class="text-muted text-center py-4">履歴データはありません。</div>`;
        return;
    }
    
    state.history.forEach((item, index) => {
        const itemClass = item.result === 'OK' ? 'border-start border-success border-4' : 'border-start border-danger border-4';
        const badgeClass = item.result === 'OK' ? 'badge-ok' : 'badge-ng';
        
        const card = document.createElement('div');
        card.className = `card mb-2 ${itemClass}`;
        card.innerHTML = `
            <div class="card-body p-3">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <span class="badge ${badgeClass} px-3 py-1 fw-bold fs-6">${item.result}</span>
                    <small class="text-muted">${item.timestamp}</small>
                </div>
                <div class="row g-1 text-secondary" style="font-size: 0.9em;">
                    <div class="col-6">
                        <strong>作業員:</strong> ${item.employeeId}
                    </div>
                    <div class="col-6 text-end">
                        <strong>注文番号:</strong> ${item.orderNo || '-'}
                    </div>
                    <div class="col-12 mt-1">
                        <table class="table table-bordered table-sm mb-0 style-table" style="font-size: 0.9em;">
                            <thead class="bg-light">
                                <tr>
                                    <th>納品書品番</th>
                                    <th>現品票品番</th>
                                    <th>流動表品番</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td><span class="font-monospace">${item.deliveryPart}</span></td>
                                    <td><span class="font-monospace">${item.itemPart}</span></td>
                                    <td><span class="font-monospace">${item.processPart}</span></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="col-4 mt-2">
                        <span class="parsed-field-label">次区:</span> <span class="fw-bold text-dark">${item.nextArea || '-'}</span>
                    </div>
                    <div class="col-4 mt-2">
                        <span class="parsed-field-label">納期:</span> <span class="fw-bold text-dark">${item.deliveryDate || '-'}</span>
                    </div>
                    <div class="col-4 mt-2">
                        <span class="parsed-field-label">数量:</span> <span class="fw-bold text-dark">${item.quantity || '-'}</span>
                    </div>
                    <div class="col-12 mt-1">
                        <span class="parsed-field-label">ロット番号:</span> <span class="fw-bold text-dark">${item.lotNo || '-'}</span>
                    </div>
                </div>
            </div>
        `;
        listContainer.appendChild(card);
    });
}

// Setup Demo / Testing Panel Utilities
function setupDemoPresets() {
    // Generate valid mock strings
    // Delivery note is fixed format (At least 212 characters)
    // Indexes of values in code (0-based translation of 1-based specs):
    // 127-136 (Part Number: "1234567890") (idx 126-135)
    // 156-159 (Next Area: "A-01") (idx 155-158)
    // 180-187 (Delivery Date: "20260724") (idx 179-186)
    // 192-197 (Quantity: "000150") (idx 191-196)
    // 204-212 (Order No: "PO-998822") (idx 203-211)
    
    const pad = (str, len, char = ' ') => str.padEnd(len, char);
    
    // We create a base string of 220 characters
    let baseStr = '';
    for (let i = 1; i <= 220; i++) {
        baseStr += (i % 10); // Filler character pattern
    }
    
    // Inject correct fields for OK test
    // Character indices map to index in JS as (charNum - 1)
    function injectField(base, fieldVal, startChar, endChar) {
        const start = startChar - 1;
        const length = endChar - startChar + 1;
        const paddedVal = fieldVal.slice(0, length).padEnd(length, ' ');
        return base.substring(0, start) + paddedVal + base.substring(start + length);
    }
    
    const partNoOK = "ABC-123-X9"; // Exactly 10 characters
    let okDeliveryQR = baseStr;
    okDeliveryQR = injectField(okDeliveryQR, partNoOK, 127, 136);
    okDeliveryQR = injectField(okDeliveryQR, "B-04", 156, 159);
    okDeliveryQR = injectField(okDeliveryQR, "20260724", 180, 187);
    okDeliveryQR = injectField(okDeliveryQR, "001250", 192, 197);
    okDeliveryQR = injectField(okDeliveryQR, "ORD-87112", 204, 212);
    
    const okItemQR = partNoOK; // Exactly 10 characters
    const okProcessQR = partNoOK + "LOT9988776655"; // First 10 is part number, rest is lot
    
    // Setup Demo buttons click handlers
    document.getElementById('btn-demo-load-ok').addEventListener('click', () => {
        state.employeeId = "EMP-0897";
        updateEmployeeUI();
        
        processCodeData('delivery', okDeliveryQR);
        processCodeData('item', okItemQR);
        processCodeData('process', okProcessQR);
    });
    
    document.getElementById('btn-demo-load-ng-part').addEventListener('click', () => {
        state.employeeId = "EMP-0897";
        updateEmployeeUI();
        
        // Mismatch item part number
        processCodeData('delivery', okDeliveryQR);
        processCodeData('item', "XYZ-999-99"); // Different part number
        processCodeData('process', okProcessQR);
    });
    
    document.getElementById('btn-demo-load-ng-proc').addEventListener('click', () => {
        state.employeeId = "EMP-0897";
        updateEmployeeUI();
        
        // Mismatch process sheet part number
        processCodeData('delivery', okDeliveryQR);
        processCodeData('item', okItemQR);
        processCodeData('process', "9999999999LOT112233"); // Different part number
    });
    
    // Setup individual manual override inputs
    document.getElementById('btn-demo-emp-set').addEventListener('click', () => {
        const val = document.getElementById('demo-employee-id').value;
        if (val) processCodeData('employee', val);
    });
    
    document.getElementById('btn-demo-del-set').addEventListener('click', () => {
        const val = document.getElementById('demo-delivery-raw').value;
        if (val) processCodeData('delivery', val);
    });
    
    document.getElementById('btn-demo-item-set').addEventListener('click', () => {
        const val = document.getElementById('demo-item-raw').value;
        if (val) processCodeData('item', val);
    });
    
    document.getElementById('btn-demo-proc-set').addEventListener('click', () => {
        const val = document.getElementById('demo-process-raw').value;
        if (val) processCodeData('process', val);
    });
}

// Document Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // History initialization
    loadHistory();
    setupDemoPresets();
    
        // Camera trigger events
    const scanEmployeeBtn = document.getElementById('btn-scan-employee');
    if (scanEmployeeBtn) scanEmployeeBtn.addEventListener('click', () => startCamera('employee'));
    
    const scanDelBtn = document.getElementById('btn-slot-scan-delivery');
    if (scanDelBtn) scanDelBtn.addEventListener('click', () => startCamera('delivery'));
    
    const scanItemBtn = document.getElementById('btn-slot-scan-item');
    if (scanItemBtn) scanItemBtn.addEventListener('click', () => startCamera('item'));
    
    const scanProcBtn = document.getElementById('btn-slot-scan-process');
    if (scanProcBtn) scanProcBtn.addEventListener('click', () => startCamera('process'));
    
    // Utilities
    document.getElementById('btn-reset').addEventListener('click', resetCurrentScans);
    document.getElementById('btn-export-csv').addEventListener('click', exportHistoryToCSV);
    document.getElementById('btn-clear-history').addEventListener('click', clearHistory);
    
    // Stop camera when scanner modal is dismissed
    const modalEl = document.getElementById('scannerModal');
    modalEl.addEventListener('hidden.bs.modal', stopCamera);
    
    // Log initial UI
    updateEmployeeUI();
    updateVerificationUI();
});
