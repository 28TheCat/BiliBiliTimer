// 由页面内容脚本获取所属标签页，悬浮面板始终操作该页面。
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GetTimerTab' && sender.tab
        && /^https:\/\/www\.bilibili\.com\/video\//.test(sender.url || '')) {
        sendResponse({ tabId: sender.tab.id });
    }
});

const insertMarkerMenu = {
    id: 'InsertMarker',
    title: '标记一下',
    contexts: ['link'],
    documentUrlPatterns: ['https://www.bilibili.com/video/*']
};

const quickCopyMenu = {
    id: 'QuickCopy',
    title: '计算到此时长',
    contexts: ['link'],
    documentUrlPatterns: ['https://www.bilibili.com/video/*']
};

function syncQuickCopyMenu() {
    chrome.storage.sync.get('blockMenuItem', function (data) {
        if (data.blockMenuItem) {
            chrome.contextMenus.remove('QuickCopy', () => {
                // The item may already be absent; clear the expected API error.
                void chrome.runtime.lastError;
            });
        } else {
            chrome.contextMenus.create(quickCopyMenu, () => {
                // The item may already exist when settings change or the worker starts.
                void chrome.runtime.lastError;
            });
        }
    });
}

// Context menu items survive service worker restarts. Create them only on install/update,
// rather than at top level each time Chrome wakes the worker.
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        void chrome.runtime.lastError;
        chrome.contextMenus.create(insertMarkerMenu);
        syncQuickCopyMenu();
    });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.blockMenuItem) {
        syncQuickCopyMenu();
    }
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
    let target = info.linkUrl // https://www.bilibili.com/video/BV1gM411W7ex/?p=1
    // 使用正则表达式提取视频p参数
    let p = target.match(/p=\d+/)[0].match(/\d+/)[0], bvid = target.match(/BV\w+/)[0];
    switch (info.menuItemId) {
        case 'QuickCopy':
            chrome.storage.local.set({ clipboardData: p }); // 将p参数存入本地存储, 用于popup.js中的粘贴功能
            chrome.storage.sync.get('blockNotification', function (data) {
                let blockNotification = data.blockNotification;
                if (!blockNotification) {
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: '../icons/timeline.png',
                        title: 'BilibiliTimer扩展通知',
                        message: `已复制到剪贴板：${p}`,
                    });
                }
            });
            break;
        case 'InsertMarker':
            chrome.tabs.sendMessage(tab.id, { action: "InsertMarker", p_mark: p, bvid: bvid })
            break;
    }
});

/* 
* 关于动态图标设置
*/
var manifest = chrome.runtime.getManifest();
var matches_reg = manifest.content_scripts[0].matches.map(m => m.replace(/\*/g, '.*'));;

chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, tabHandler);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status == 'complete') {
        tabHandler(tab);
    }
});

function tabHandler(tab) {
    let url = tab.url;
    let isMatched = matches_reg.some(m => new RegExp(m).test(url));
    // console.log('urlMatch:', isMatched, url);

    if (isMatched) {
        chrome.action.setIcon({ path: "../icons/timeline.png" });
        chrome.action.enable();
    } else {
        chrome.action.setIcon({ path: "../icons/timeline_grey.png" });
        chrome.action.disable();
    }
}
