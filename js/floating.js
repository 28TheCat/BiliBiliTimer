// 页面只挂载轻量入口；点击后加载与工具栏相同的弹窗页面。
(() => {
    if (window.top !== window || !/^https:\/\/www\.bilibili\.com\/video\//.test(location.href)
        || document.getElementById('bili-timer-floating')) return;

    const host = document.createElement('div');
    host.id = 'bili-timer-floating';
    host.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
        <style>
            :host { all: initial; font: 13px/1.5 system-ui, sans-serif; }
            button { font: inherit; cursor: pointer; }
            #toggle { display: grid; place-items: center; box-sizing: border-box;
                width: 38px; height: 38px; border: 1px solid #ffffff30; border-radius: 50%; padding: 0;
                background: #ad5574; color: #ffe0eb; box-shadow: 0 2px 10px #0003;
                touch-action: none; user-select: none; }
            #toggle:hover { background: #bf6484; }
            #toggle:focus-visible { outline: 2px solid #00a1d6; outline-offset: 3px; }
            #toggle.error { border-color: #e74c3c; }
            #toggle svg { width: 25px; height: 25px; pointer-events: none; }
            #panel { width: 300px; max-width: calc(100vw - 16px); border-radius: 12px;
                overflow: hidden; background: white; box-shadow: 0 6px 28px #0003; }
            #header { display: flex; justify-content: space-between; align-items: center;
                padding: 7px 12px; background: #00a1d6; color: white;
                cursor: move; touch-action: none; user-select: none; }
            #close { border: 0; padding: 0 4px; background: transparent; color: white;
                font-size: 20px; line-height: 1; }
            iframe { display: block; width: 100%; height: 400px; border: 0; background: white; }
            [hidden] { display: none !important; }
        </style>
        <button id="toggle" type="button" title="点击查看剩余时长，拖动调整位置"
            aria-label="剩余时长" aria-expanded="false" aria-controls="panel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M9 2h6M12 2v3m6 1 1.5-1.5" />
                <circle cx="12" cy="14" r="8" />
                <path d="M12 9v5l3 2" />
            </svg>
        </button>
        <section id="panel" hidden aria-label="视频时长计算">
            <div id="header"><span>视频时长 · 拖动移动</span>
                <button id="close" type="button" aria-label="收起面板">×</button>
            </div>
        </section>`;
    const toggle = root.getElementById('toggle');
    const panel = root.getElementById('panel');
    const header = root.getElementById('header');
    const close = root.getElementById('close');
    let frame = null;
    let panelToken = null;
    let panelHeight = 400;
    let opening = false;
    let position = { x: window.innerWidth - 60, y: 140 };
    let buttonPosition = null;
    let savedPosition = false;
    let drag = null;
    let dragged = false;

    function place() {
        const bounds = host.getBoundingClientRect();
        position.x = Math.max(8, Math.min(position.x, window.innerWidth - bounds.width - 8));
        position.y = Math.max(8, Math.min(position.y, window.innerHeight - bounds.height - 8));
        host.style.left = `${position.x}px`;
        host.style.top = `${position.y}px`;
    }

    function collapse() {
        opening = false;
        frame?.remove(); // 卸载 iframe，释放计算面板和标签页监听。
        frame = null;
        panelToken = null;
        panel.hidden = true;
        toggle.hidden = false;
        toggle.setAttribute('aria-expanded', 'false');
        if (buttonPosition) position = { ...buttonPosition };
        place();
        toggle.focus();
    }

    async function expand() {
        if (opening || frame) return;
        opening = true;
        toggle.disabled = true;
        try {
            const result = await chrome.runtime.sendMessage({ action: 'GetTimerTab' });
            if (!opening) return;
            if (!Number.isSafeInteger(result?.tabId)) throw new Error('无法识别当前标签页');
            frame = document.createElement('iframe');
            frame.title = 'Bilibili Video Timer';
            panelToken = crypto.randomUUID();
            frame.src = chrome.runtime.getURL(
                `popup.html?floating=1&tabId=${result.tabId}&panelToken=${panelToken}`
            );
            panel.append(frame);
            panel.hidden = false;
            toggle.hidden = true;
            toggle.setAttribute('aria-expanded', 'true');
            toggle.classList.remove('error');
            toggle.title = '点击查看剩余时长，拖动调整位置';
            buttonPosition = { ...position };
            place();
        } catch (error) {
            console.error('Bilibili Timer:', error);
            toggle.classList.add('error');
            toggle.title = '无法打开面板，请刷新页面重试';
        } finally {
            opening = false;
            toggle.disabled = false;
        }
    }

    toggle.addEventListener('click', () => {
        if (dragged) { dragged = false; return; }
        expand();
    });
    close.addEventListener('click', collapse);
    root.addEventListener('keydown', event => {
        if (event.key === 'Escape' && frame) collapse();
    });

    for (const handle of [toggle, header]) {
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.target === close) return;
            drag = { x: event.clientX, y: event.clientY, start: { ...position } };
            dragged = false;
            handle.setPointerCapture(event.pointerId);
        });
        handle.addEventListener('pointermove', event => {
            if (!drag) return;
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            if (!dragged && Math.hypot(dx, dy) < 5) return;
            dragged = true;
            position = { x: drag.start.x + dx, y: drag.start.y + dy };
            place();
        });
        const finish = () => {
            if (!drag) return;
            drag = null;
            if (dragged) {
                savedPosition = true;
                if (frame) buttonPosition = { ...position };
                chrome.storage.local.set({ BiliTimer_floatingPosition: position }).catch(console.error);
            }
        };
        handle.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', finish);
    }

    window.addEventListener('message', event => {
        // 内容脚本中 MessageEvent.source 可能为空，使用扩展来源和面板令牌校验。
        if (!frame || event.origin !== chrome.runtime.getURL('').replace(/\/$/, '')
            || event.data?.panelToken !== panelToken) return;
        if (event.data?.type === 'BiliTimerPanelClose') {
            collapse();
            return;
        }
        if (event.data?.type !== 'BiliTimerPanelHeight') return;
        const height = event.data.height;
        if (!Number.isFinite(height) || height <= 0) return;
        panelHeight = height;
        frame.style.height = `${Math.min(height, Math.max(80, window.innerHeight - 64))}px`;
        place();
    });
    window.addEventListener('resize', () => {
        if (frame) frame.style.height = `${Math.min(panelHeight, Math.max(80, window.innerHeight - 64))}px`;
        place();
    });
    document.body.append(host);
    place();
    chrome.storage.local.get('BiliTimer_floatingPosition').then(data => {
        const stored = data.BiliTimer_floatingPosition;
        if (!savedPosition && stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
            position = stored;
            place();
        }
    }).catch(console.error);
})();
