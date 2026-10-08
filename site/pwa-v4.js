(() => {
  "use strict";
  let deferredInstall = null;
  let registration = null;
  const ua = navigator.userAgent || "";
  const isWeChat = /MicroMessenger/i.test(ua);
  const isIPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || isIPadOS;

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }

  function showInstallHelp(message) {
    window.dispatchEvent(new CustomEvent("schedule:pwa-help", { detail:{ message } }));
  }

  async function requestInstall(trigger) {
    if (isStandalone()) return;
    if (isWeChat) {
      showInstallHelp(isIOS
        ? "请点微信右上角菜单，用 Safari 打开；然后点 Safari 的分享按钮，选择“添加到主屏幕”。"
        : "请点微信右上角菜单，选择“在浏览器打开”；然后在浏览器菜单中选择“安装应用”或“添加到桌面”。");
      return;
    }
    if (deferredInstall) {
      const prompt = deferredInstall;
      deferredInstall = null;
      await prompt.prompt();
      await prompt.userChoice;
      return;
    }
    if (isIOS) {
      showInstallHelp("请用 Safari 打开本页，点底部分享按钮，再选择“添加到主屏幕”。");
      return;
    }
    showInstallHelp("请打开浏览器菜单，选择“安装应用”或“添加到桌面”。如果没有该选项，可改用 Chrome、Edge 或 Safari。");
    trigger?.blur?.();
  }

  let updating = false;

  // 点击更新：无论走哪条路径，最多约 3 秒内一定刷新，不会卡在“点了没反应”。
  async function applyUpdate(toast) {
    if (updating) return;
    updating = true;
    toast.classList.add("busy");
    toast.disabled = true;
    toast.querySelector(".pwa-update-text").textContent = "正在更新…";

    let reg = registration;
    try { reg = reg || await navigator.serviceWorker?.getRegistration?.(); } catch (_) {}
    const waiting = reg?.waiting;
    if (waiting) {
      // 让新 SW 接管；等它接管，或 2.5 秒超时，二者取先到。
      // 原先只等 controllerchange，若等待中的 SW 已失效，事件永远不来。
      await new Promise(resolve => {
        const done = () => resolve();
        navigator.serviceWorker.addEventListener("controllerchange", done, { once:true });
        setTimeout(done, 2500);
        try { waiting.postMessage({ type:"SKIP_WAITING" }); } catch (_) { done(); }
      });
    }
    // 删掉所有版本缓存里的首页，保证这次刷新一定从网络拿新页。
    try {
      for (const key of await caches.keys()) {
        if (!key.startsWith("schedule-pwa-")) continue;
        const cache = await caches.open(key);
        await cache.delete("/");
        await cache.delete("/index.html");
      }
    } catch (_) {}
    location.reload();
    // 极端情况下 reload 被系统挂起：4 秒后恢复按钮，允许再点一次。
    setTimeout(() => {
      updating = false;
      toast.disabled = false;
      toast.classList.remove("busy");
      toast.querySelector(".pwa-update-text").textContent = "课表有新版本";
    }, 4000);
  }

  function ensureUpdateToast() {
    let toast = document.querySelector(".pwa-update-toast");
    if (toast) return toast;
    toast = document.createElement("button");
    toast.type = "button";
    toast.className = "pwa-update-toast";
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML = "<span class=\"pwa-update-text\">课表有新版本</span><span class=\"pwa-update-action\">更新</span>";
    toast.addEventListener("click", () => applyUpdate(toast));
    document.body.append(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("visible")));
    return toast;
  }

  function showWorkerUpdate(reg) {
    registration = reg;
    ensureUpdateToast();
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstall = event;
  });
  window.addEventListener("appinstalled", () => { deferredInstall = null; });

  navigator.serviceWorker?.addEventListener("message", event => {
    if (event.data?.type === "APP_UPDATED") ensureUpdateToast();
  });

  function idle(task,timeout=4000){
    if('requestIdleCallback' in window)requestIdleCallback(task,{timeout});else setTimeout(task,1800);
  }
  function warmOptional(){
    if(document.hidden)return;
    idle(()=>{if(document.body.classList.contains('optical-on'))return;navigator.serviceWorker?.controller?.postMessage({type:'WARM_OPTIONAL'});});
  }
  navigator.serviceWorker?.addEventListener('controllerchange',warmOptional);
  let lastCheck = 0;
  function checkForUpdate(){
    const now = Date.now();
    if (!registration || now - lastCheck < 60000) return;
    lastCheck = now;
    registration.update?.().catch(()=>{});
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){warmOptional();checkForUpdate();}});
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => {
      idle(async () => {
        try {
          const reg = await navigator.serviceWorker.register("/sw.js", { scope:"/" });
          registration = reg;
          if (reg.waiting && navigator.serviceWorker.controller) showWorkerUpdate(reg);
          reg.addEventListener("updatefound", () => {
            const worker = reg.installing;
            worker?.addEventListener("statechange", () => {
              if (worker.state === "installed" && navigator.serviceWorker.controller) showWorkerUpdate(reg);
            });
          });
          navigator.serviceWorker.ready.then(warmOptional).catch(()=>{});
        } catch (_) {}
      });
    }, { once:true });
  }

  window.SchedulePWA = { isStandalone, requestInstall };
})();
