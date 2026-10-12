const btn_cal = document.getElementById('btn-cal');
const btn_back = document.getElementById('btn-back');
const stime = document.getElementById('showtime');
const startp = document.getElementById('p_start');
const endp = document.getElementById('p_end');
const ranger = document.getElementById('customRange2');
const progress = document.getElementById('prgs');
const mode = document.getElementById('cal-mode');
let context = null;

startp.addEventListener('focus', function () { this.select(); });
endp.addEventListener('focus', function () { this.select(); });

// 每次点击重新读取页面状态，不启动定时器或监听播放事件。
async function readContext() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
    return { durations, current, playback, group, bvid: playback.bvid };
}

function clampEpisode(value, fallback) {
    const number = Number.parseInt(value, 10);
    return Math.min(context.durations.length, Math.max(1, Number.isFinite(number) ? number : fallback));
}

function formatTime(seconds) {
    seconds = Math.ceil(Math.max(0, seconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const rest = seconds % 60;
    return [hours ? `${hours}h` : '', minutes ? `${minutes}min` : '',
        rest || (!hours && !minutes) ? `${rest}s` : ''].filter(Boolean).join(' ');
}

function updateMode() {
    startp.disabled = mode.value === 'remaining';
    document.getElementById('mode-info').textContent = mode.value === 'remaining'
        ? '从当前播放位置计算到最后一集，可修改结束集。'
        : '计算起始集到结束集的完整时长，包含首尾集。';
}

function updateProgress() {
    const { durations, current, playback, group } = context;
    const total = durations.reduce((sum, seconds) => sum + seconds, 0);
    const done = durations.slice(0, current - 1).reduce((sum, seconds) => sum + seconds, 0)
        + (playback.ready ? Math.min(durations[current - 1], playback.currentTime) : 0);
    const width = total ? Math.min(100, done / total * 100).toFixed(2) : '0.00';
    progress.style.width = `${width}%`;
    progress.setAttribute('aria-valuenow', width);
    document.getElementById('prgs_info').textContent =
        `当前进度 ${width}% · 第 ${current}/${durations.length} 集${group ? ` · ${group}` : ''}`;
}

async function calculate(reset = false, quickEnd = null) {
    const controls = [btn_cal, btn_back, mode, startp, endp, ranger];
    controls.forEach(control => { control.disabled = true; });
    stime.value = mode.value === 'remaining' ? '正在读取播放进度' : '正在读取视频时长';
    try {
        const previous = context;
        context = await readContext();
        const { durations, current, playback } = context;
        const count = durations.length;
        startp.max = endp.max = ranger.max = count;
        if (reset || (previous && (previous.bvid !== context.bvid || previous.group !== context.group))) {
            startp.value = current;
            endp.value = count;
        }
        if (quickEnd !== null) endp.value = quickEnd;
        let first = clampEpisode(startp.value, current);
        let last = clampEpisode(endp.value, count);
        if (mode.value === 'remaining') {
            first = current;
            last = Math.max(current, last);
        } else if (first > last) {
            [first, last] = [last, first];
        }
        startp.value = first;
        endp.value = ranger.value = last;
        ranger.min = endp.min = mode.value === 'remaining' ? current : 1;
        updateProgress();
        if (mode.value === 'remaining' && !playback.ready) {
            stime.value = '正在读取播放进度，请稍后点击计算';
            return;
        }
        let seconds = durations.slice(first - 1, last).reduce((sum, value) => sum + value, 0);
        if (mode.value === 'remaining') {
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
        updateMode();
    }
}

ranger.addEventListener('input', function () { endp.value = this.value; });
btn_cal.addEventListener('click', () => calculate());
btn_back.addEventListener('click', () => {
    mode.value = 'remaining';
    calculate(true);
});
mode.addEventListener('change', () => calculate(true));

async function initialize() {
    try {
        // 保留右键“计算到此时长”的目标，默认仍从当前播放位置开始。
        const { clipboardData } = await chrome.storage.local.get('clipboardData');
        if (clipboardData) await chrome.storage.local.remove('clipboardData');
        await calculate(true, clipboardData || null);
    } catch (error) {
        stime.value = error.message || '初始化失败，请重试';
    }
}

document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;
document.getElementById('author').textContent = 'by wyy';
initialize();
