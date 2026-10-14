const btn_cal = document.getElementById('btn-cal');
const btn_back = document.getElementById('btn-back');
const stime = document.getElementById('showtime');
const startp = document.getElementById('p_start');
const endp = document.getElementById('p_end');
const endRange = document.getElementById('endRange');
const rangeLabel = document.getElementById('rangeLabel');
const progress = document.getElementById('prgs');
let isCustomRange = false;
let activeEndpoint = 'end';
let context = null;
let pendingUrl = null;
// 仅在面板生命周期内保存，不增加存储写入或网络请求。
const customRanges = new Map();
const panelParams = new URLSearchParams(window.location.search);
const floating = panelParams.get('floating') === '1';
const hostTabId = Number(panelParams.get('tabId'));

startp.addEventListener('focus', function () { this.select(); });
endp.addEventListener('focus', function () { this.select(); });

function selectEndpoint(endpoint) {
    activeEndpoint = endpoint;
    rangeLabel.textContent = `滑动选择${endpoint === 'start' ? '起始' : '结束'}集`;
    const selectedInput = endpoint === 'start' ? startp : endp;
    if (context) endRange.value = clampEpisode(selectedInput.value,
        endpoint === 'start' ? context.current : context.durations.length);
}
startp.addEventListener('focus', () => selectEndpoint('start'));
endp.addEventListener('focus', () => selectEndpoint('end'));

// 每次点击重新读取页面状态，不启动定时器或监听播放事件。
async function readContext() {
    const tab = floating && Number.isSafeInteger(hostTabId) && hostTabId > 0
        ? await chrome.tabs.get(hostTabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab || !/^https:\/\/www\.bilibili\.com\/video\//.test(tab.url || '')) {
        throw new Error('请在 B 站视频播放页使用');
    }
    const snapshot = await chrome.tabs.sendMessage(tab.id, { action: 'GetPlaybackState' });
    if (!snapshot?.bvid) throw new Error('无法识别当前视频，请刷新视频页后重试');
    const result = await chrome.tabs.sendMessage(tab.id, {
        action: 'GetVideoInfo', bvid: snapshot.bvid
    });
    if (!result?.data) throw new Error('无法获取视频时长，请重试');
    // 请求期间可能发生切集，使用最新状态；跨 BV 切换时请重新计算。
    const playback = await chrome.tabs.sendMessage(tab.id, { action: 'GetPlaybackState' });
    if (!playback || playback.bvid !== snapshot.bvid) throw new Error('视频已切换，请重新计算');
    const { vtype, data } = result;
    let durations;
    let current = 1;
    let group = '';
    if (vtype === 2) {
        durations = data.pages.map(page => page.duration);
        current = playback.page;
    } else if (vtype === 3) {
        const section = data.ugc_season.sections.find(section =>
            section.episodes.some(episode => episode.aid === data.aid));
        if (!section) throw new Error('无法识别当前合集分组');
        durations = section.episodes.map(episode => episode.page.duration);
        current = section.episodes.findIndex(episode => episode.aid === data.aid) + 1;
        group = section.title || '';
    } else {
        durations = [data.duration];
    }
    if (!durations.length || durations.some(seconds => !Number.isFinite(seconds) || seconds < 0)
        || current < 1 || current > durations.length) {
        throw new Error('视频时长或集数无效，请刷新视频页后重试');
    }
    return {
        durations, current, playback, group, bvid: playback.bvid, tabId: tab.id,
        sections: vtype === 3 ? data.ugc_season.sections : null
    };
}

function clampEpisode(value, fallback) {
    const number = Number.parseInt(value, 10);
    return Math.min(context.durations.length, Math.max(1, Number.isFinite(number) ? number : fallback));
}

function rangeKey() {
    // 合集使用分组内第一个视频作为标识，同组切集仍复用同一区间。
    if (context.sections) {
        const section = context.sections.find(section =>
            section.episodes.some(episode => episode.bvid === context.bvid));
        return `section:${section?.episodes[0]?.bvid || context.bvid}`;
    }
    return `video:${context.bvid}`;
}

function rememberCustomRange() {
    if (!context) return;
    customRanges.set(rangeKey(), { start: startp.value, end: endp.value });
}

function formatTime(seconds) {
    seconds = Math.ceil(Math.max(0, seconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const rest = seconds % 60;
    return [hours ? `${hours}h` : '', minutes ? `${minutes}min` : '',
        rest || (!hours && !minutes) ? `${rest}s` : ''].filter(Boolean).join(' ');
}

function updateRangeHint() {
    document.getElementById('mode-info').textContent = !isCustomRange
        ? '默认计算当前位置到最后一集；修改集数后计算完整区间。'
        : '自定义区间：计算所选各集完整时长，包含首尾集。';
}

function updateProgress(includeCurrentTime = true) {
    const { durations, current, playback, group } = context;
    const total = durations.reduce((sum, seconds) => sum + seconds, 0);
    const done = durations.slice(0, current - 1).reduce((sum, seconds) => sum + seconds, 0)
        + (includeCurrentTime && playback.ready ? Math.min(durations[current - 1], playback.currentTime) : 0);
    const width = total ? Math.min(100, done / total * 100).toFixed(2) : '0.00';
    progress.style.width = `${width}%`;
    progress.setAttribute('aria-valuenow', width);
    document.getElementById('prgs_info').textContent =
        `${includeCurrentTime ? '当前进度' : '集数进度'} ${width}% · 第 ${current}/${durations.length} 集${group ? ` · ${group}` : ''}`;
}

// 仅弹窗打开期间响应 URL 变化；切集时复用时长，不请求接口或读取播放器。
function updateEpisodeProgress(url) {
    if (!context) return;
    let target;
    try {
        target = new URL(url);
    } catch {
        return;
    }
    const bvid = target.hostname === 'www.bilibili.com'
        ? target.pathname.match(/^\/video\/(BV\w+)\/?$/)?.[1] : null;
    const page = Number(target.searchParams.get('p') || 1);
    if (bvid === context.bvid && page === context.current && !context.sections) return;
    let current = page;
    let durations = context.durations;
    let group = context.group;
    if (context.sections) {
        const section = context.sections.find(section =>
            section.episodes.some(episode => episode.bvid === bvid));
        if (section) {
            current = section.episodes.findIndex(episode => episode.bvid === bvid) + 1;
            if (bvid === context.bvid && current === context.current) return;
            durations = section.episodes.map(episode => episode.page.duration);
            group = section.title || '';
        } else {
            current = NaN;
        }
    } else if (!bvid || bvid !== context.bvid) {
        current = NaN;
    }
    if (!Number.isSafeInteger(current) || current < 1 || current > durations.length
        || durations.some(seconds => !Number.isFinite(seconds) || seconds < 0)) {
        progress.style.width = '0%';
        progress.setAttribute('aria-valuenow', 0);
        // 新视频不在缓存内时自动读取一次；同一列表切集走下面的缓存计算。
        document.getElementById('prgs_info').textContent = '正在读取新视频进度';
        calculate(true);
        return;
    }
    const previousRangeKey = rangeKey();
    if (isCustomRange) rememberCustomRange();
    context = { ...context, bvid, current, durations, group,
        playback: { ready: false, currentTime: 0 } };
    startp.max = endp.max = endRange.max = durations.length;
    if (!isCustomRange) {
        startp.value = current;
        endp.value = endRange.value = durations.length;
        document.getElementById('mode-info').textContent =
            '已按本集开头计算到最后一集；点击计算可读取当前播放位置。';
    } else if (rangeKey() !== previousRangeKey) {
        const saved = customRanges.get(rangeKey());
        startp.value = saved ? clampEpisode(saved.start, current) : current;
        endp.value = endRange.value = saved ? clampEpisode(saved.end, durations.length) : durations.length;
    }
    let first = clampEpisode(startp.value, current);
    let last = clampEpisode(endp.value, durations.length);
    if (first > last) [first, last] = [last, first];
    startp.value = first;
    endp.value = last;
    endRange.value = activeEndpoint === 'start' ? first : last;
    if (isCustomRange) rememberCustomRange();
    stime.value = formatTime(durations.slice(first - 1, last).reduce((sum, seconds) => sum + seconds, 0));
    updateProgress(false);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId !== context?.tabId || !changeInfo.url) return;
    // 手动计算过程中先记录 URL，避免旧请求覆盖切集后的百分比。
    if (btn_cal.disabled) pendingUrl = changeInfo.url;
    else updateEpisodeProgress(changeInfo.url);
});

async function calculate(reset = false, quickEnd = null) {
    const controls = [btn_cal, btn_back, startp, endp, endRange];
    controls.forEach(control => { control.disabled = true; });
    stime.value = !isCustomRange ? '正在读取播放进度' : '正在读取视频时长';
    try {
        const previous = context;
        context = await readContext();
        const { durations, current, playback } = context;
        const count = durations.length;
        startp.max = endp.max = endRange.max = count;
        if (reset || (previous && (previous.bvid !== context.bvid || previous.group !== context.group))) {
            const saved = isCustomRange ? customRanges.get(rangeKey()) : null;
            startp.value = saved ? saved.start : current;
            endp.value = saved ? saved.end : count;
        }
        if (quickEnd !== null) endp.value = quickEnd;
        let first = clampEpisode(startp.value, current);
        let last = clampEpisode(endp.value, count);
        if (!isCustomRange) {
            first = current;
            last = count;
        } else if (first > last) {
            [first, last] = [last, first];
        }
        startp.value = first;
        endp.value = last;
        endRange.value = activeEndpoint === 'start' ? first : last;
        if (isCustomRange) rememberCustomRange();
        endRange.min = startp.min = endp.min = 1;
        updateProgress();
        if (!isCustomRange && !playback.ready) {
            stime.value = '正在读取播放进度，请稍后点击计算';
            return;
        }
        let seconds = durations.slice(first - 1, last).reduce((sum, value) => sum + value, 0);
        if (!isCustomRange) {
            // 当前集以播放器真实时长为准，后续各集使用 API 时长。
            seconds += Math.max(0, playback.duration - playback.currentTime) - durations[current - 1];
        }
        stime.value = formatTime(seconds);
    } catch (error) {
        console.error(error);
        stime.value = error.message?.includes('Receiving end does not exist')
            ? '请刷新视频页后重试' : (error.message || '读取失败，请重试');
    } finally {
        controls.forEach(control => { control.disabled = false; });
        updateRangeHint();
        if (pendingUrl) {
            const url = pendingUrl;
            pendingUrl = null;
            updateEpisodeProgress(url);
        }
    }
}

function editRange() {
    isCustomRange = true;
    if (context) {
        const selectedInput = activeEndpoint === 'start' ? startp : endp;
        endRange.value = clampEpisode(selectedInput.value, context.durations.length);
    }
    rememberCustomRange();
    updateRangeHint();
    stime.value = '区间已修改，请点击计算';
}
for (const input of [startp, endp]) {
    input.addEventListener('input', editRange);
}
endRange.addEventListener('input', function () {
    (activeEndpoint === 'start' ? startp : endp).value = this.value;
    editRange();
});
btn_cal.addEventListener('click', () => calculate());
btn_back.addEventListener('click', () => {
    if (isCustomRange) rememberCustomRange();
    isCustomRange = false;
    calculate(true);
});

async function initialize() {
    try {
        // 右键指定结束集也视为用户自定义区间。
        const { clipboardData } = await chrome.storage.local.get('clipboardData');
        if (clipboardData) await chrome.storage.local.remove('clipboardData');
        isCustomRange = Boolean(clipboardData);
        await calculate(true, clipboardData || null);
    } catch (error) {
        stime.value = error.message || '初始化失败，请重试';
    }
}

document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;
document.getElementById('author').textContent = 'by wyy';
if (floating) {
    // 父页面只接收高度通知；计算和权限操作仍由扩展页面完成。
    new ResizeObserver(() => {
        window.parent.postMessage({
            type: 'BiliTimerPanelHeight', height: document.body.scrollHeight,
            panelToken: panelParams.get('panelToken')
        }, 'https://www.bilibili.com');
    }).observe(document.body);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            window.parent.postMessage({
                type: 'BiliTimerPanelClose', panelToken: panelParams.get('panelToken')
            }, 'https://www.bilibili.com');
        }
    });
}
initialize();
