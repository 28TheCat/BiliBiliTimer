/* 
* chrome.storage.sync与chrome.storage.local的区别：
*   chrome.storage.sync：同步存储，用户在不同的设备上登录时，数据会同步
*   chrome.storage.local：本地存储，用户在不同的设备上登录时，数据不会同步
*/
let notificationToggle = document.getElementById('blockNotification');
let menuToggle = document.getElementById('blockMenuItem');
let markerInput = document.getElementById('markerInput');

const floatingEnabled = document.getElementById('floatingEnabled');
const floatingOpacity = document.getElementById('floatingOpacity');
const floatingHideFullscreen = document.getElementById('floatingHideFullscreen');
const floatingOpacityValue = document.getElementById('floatingOpacityValue');
const floatingStatus = document.getElementById('floatingSettingsStatus');
chrome.storage.sync.get({
    BiliTimer_floatingEnabled: true,
    BiliTimer_floatingOpacity: 100,
    BiliTimer_floatingHideFullscreen: true
}).then(data => {
    floatingEnabled.checked = data.BiliTimer_floatingEnabled !== false;
    floatingOpacity.value = Math.max(20, Math.min(100, Number(data.BiliTimer_floatingOpacity) || 100));
    floatingOpacityValue.textContent = `${floatingOpacity.value}%`;
    floatingHideFullscreen.checked = data.BiliTimer_floatingHideFullscreen !== false;
    for (const control of [floatingEnabled, floatingOpacity, floatingHideFullscreen]) control.disabled = false;
}).catch(() => { floatingStatus.textContent = '读取设置失败，请刷新选项页重试'; });

async function saveFloatingSetting(key, value) {
    try {
        await chrome.storage.sync.set({ [key]: value });
        floatingStatus.textContent = '已保存，已打开的视频页立即生效';
    } catch {
        floatingStatus.textContent = '保存失败，请重试';
    }
}
floatingEnabled.addEventListener('change', () =>
    saveFloatingSetting('BiliTimer_floatingEnabled', floatingEnabled.checked));
floatingHideFullscreen.addEventListener('change', () =>
    saveFloatingSetting('BiliTimer_floatingHideFullscreen', floatingHideFullscreen.checked));
floatingOpacity.addEventListener('input', () => {
    floatingOpacityValue.textContent = `${floatingOpacity.value}%`;
});
// 拖动结束才保存，避免滑块每移动一步就写入同步存储。
floatingOpacity.addEventListener('change', () =>
    saveFloatingSetting('BiliTimer_floatingOpacity', Number(floatingOpacity.value)));
document.getElementById('resetFloatingPosition').addEventListener('click', async () => {
    try {
        await chrome.storage.local.remove('BiliTimer_floatingPosition');
        floatingStatus.textContent = '位置已重置到页面右侧';
    } catch {
        floatingStatus.textContent = '重置失败，请重试';
    }
});

// 获取blockNotification的值
chrome.storage.sync.get('blockNotification', function (data) {
    // 勾选表示关闭通知；未设置时默认允许通知，与后台逻辑一致。
    notificationToggle.checked = data.blockNotification ?? false;
});
// 绑定开关的change事件
notificationToggle.addEventListener('change', function () {
    let isChecked = notificationToggle.checked;
    chrome.storage.sync.set({ blockNotification: isChecked });
    console.log('blockNotification: ' + isChecked);
});

// 右键菜单开关
chrome.storage.sync.get('blockMenuItem', function (data) {
    let blockMenuItem = data.blockMenuItem;
    // 如果showNotification为true，则将开关打开
    if (blockMenuItem) {
        menuToggle.checked = true;
    } else {
        menuToggle.checked = false;
    }
});
// 绑定开关的change事件
menuToggle.addEventListener('change', function () {
    let isChecked = menuToggle.checked;
    chrome.storage.sync.set({ blockMenuItem: isChecked });
    console.log('blockMenuItem: ' + isChecked);
    // chrome.runtime.reload(); // 重新加载插件
    // 一秒后重新加载插件();
    setTimeout(function () {
        chrome.runtime.reload();
    }, 1000);
});

// 获取默认Marker
chrome.storage.sync.get('BiliTimer_defaultMarker', function (data) {
    markerInput.value = data.BiliTimer_defaultMarker ? data.BiliTimer_defaultMarker : '✨';
});
// 默认Marker设置修改事件
markerInput.addEventListener('blur', function () {
    let marker = markerInput.value;
    console.log('New default marker: ' + marker);
    chrome.storage.sync.set({ BiliTimer_defaultMarker: marker });
});
// Marker模态框
document.getElementById('openModalButton').addEventListener('click', function () {
    let myModal = new bootstrap.Modal(document.getElementById('myModal'), {
        backdrop: true,
        keyboard: false
    });
    myModal.show();
    showMarkerList();

    // 清除marker按钮
    document.getElementById('clearBtn').addEventListener('click', function () {
        // 获取勾选的checkbox
        let checkedBvids = document.querySelectorAll('.checkBvid:checked');
        if (checkedBvids.length == 0) return;
        if (confirm('确认清空选中视频的所有标记？')) {
            console.log(checkedBvids);
            chrome.storage.sync.get('BiliTimer_marker', function (data) {
                let markers = data.BiliTimer_marker;
                for (let node of checkedBvids) {
                    let bvid = node.value;
                    console.log('Clear marker of ' + bvid + ' in ' + markers);
                    delete markers[bvid];
                }
                chrome.storage.sync.set({ BiliTimer_marker: markers });
                showMarkerList();
            });
        }
    });

    // 保存marker按钮
    document.getElementById('saveBtn').addEventListener('click', function () {
        // 遍历表单中的input，将更新的marker存入本地存储
        // 目标数据结构：{bvid: [[p:1, marker:'✨'], [p:2, marker:'✨']]}
        let allcards = document.querySelectorAll('.modal .card-body');
        let markers = {};
        for (let card of allcards) {
            let bvid = card.id;
            let inputs = card.querySelectorAll('.input-group');
            let markerList = Array.from(inputs).reduce((acc, cur) => {
                const p = cur.querySelector('span').innerText;
                const marker = cur.querySelector('input').value;
                if (marker) acc.push([p, marker]);
                return acc;
            }, [])
            if (markerList.length > 0) markers[bvid] = markerList;
        }
        chrome.storage.sync.set({ BiliTimer_marker: markers });
        console.log('Saved markers: ', markers);
        myModal.hide();
    });

    // 关闭dialog按钮
    document.getElementById('closeBtn').addEventListener('click', function () {
        myModal.hide();
    });

});

function showMarkerList() {
    chrome.storage.sync.get(null, function (allData) {
        let allMarkers = allData.BiliTimer_marker;
        let accordion = document.getElementById('accordionEx');
        if (!allMarkers || JSON.stringify(allMarkers) === '{}') { accordion.innerHTML = `<div class="text-center">似乎啥也没标记过呢(_　_)。゜zｚＺ</div>`; return; }
        console.log('All markers: ', allMarkers);
        let html = '';
        for (let [key, value] of Object.entries(allMarkers)) {
            value.sort((a, b) => a[0] - b[0]);
            let markerList = value.reduce((acc, cur, idx) => {
                return acc + `<div class="input-group input-group-sm">
                    <span class="input-group-text" id="basic-addon${idx}">${cur[0]}</span>
                    <input type="text" class="form-control" value="${cur[1]}" aria-label="${cur[1]}">
                </div>`
            }, '')

            html += `<div class="card mb-2">
                <div class="card-header" style="padding:0">
                    <label class="btn btn-secondary" style="width:100%; border-bottom-left-radius:0;border-bottom-right-radius:0;" >
                        <input type="checkbox" autocomplete="off" class="checkBvid" value="${key}"> ${key}
                    </label>
                </div>
                <div class="collapse show" data-parent="#accordionEx">
                    <div class="card-body" id="${key}">
                        ${markerList}
                    </div>
                </div>
            </div>`
        }
        accordion.innerHTML = html;
    });
}

// 获取版本号
const manifest = chrome.runtime.getManifest();
const version = manifest.version;
document.getElementById('version').innerHTML = 'v' + version;
