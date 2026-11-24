const { session, ipcMain, app } = require('electron');
const storage = require('./storage');

class AdBlocker {
  constructor() {
    this.mainWindow = null;
    this.enabled = true;
    this.tabStats = new Map(); // tabWebContentsId -> count
    this.tabUrlMap = new Map(); // tabWebContentsId -> url
    this.totalBlocked = 0;
    
    // Exact domains to block (fast Set lookup)
    this.blockedDomains = new Set([
      // Google Ads & DoubleClick
      'doubleclick.net', 'googleads.g.doubleclick.net', 'pagead2.googlesyndication.com',
      'adservice.google.com', 'googletagservices.com', 'googlesyndication.com',
      'www.googletagservices.com', 'partner.googleadservices.com', 'tpc.googlesyndication.com',
      'pagead2.googleadservices.com', 'admob.com', 'google-analytics.com', 'www.google-analytics.com',
      'analytics.google.com', 'stats.g.doubleclick.net', 'cm.g.doubleclick.net',

      // Yandex Direct, Metrika, AdFox, RSYA
      'an.yandex.ru', 'mc.yandex.ru', 'direct.yandex.ru', 'awaps.yandex.net', 'awaps.yandex.ru',
      'yabs.yandex.ru', 'adfox.ru', 'ads.adfox.ru', 'ext.adfox.ru', 'matchid.adfox.yandex.ru',
      'bs.yandex.ru', 'banners.adfox.ru', 'dsp.yandex.ru', 'clck.yandex.ru', 'fennec.yandex.ru',
      'yandexadexchange.net', 'adstat.yandex.ru', 'adfox.yandex.ru', 'ads.yandex.ru',
      'an.yandex.kz', 'an.yandex.by', 'an.yandex.uz', 'an.yandex.md', 'an.yandex.tj', 'an.yandex.az',
      'yabs.yandex.kz', 'yabs.yandex.by', 'yabs.yandex.uz',
      'direct.yandex.kz', 'direct.yandex.by',
      'mc.webvisor.com', 'mc.webvisor.org', 'mc.yandex.md', 'mc.yandex.by', 'mc.yandex.kz', 'mc.yandex.uz', 'mc.yandex.az',

      // Mail.ru / VK Ads
      'target.my.com', 'top-fwz1.mail.ru', 'ad.mail.ru', 'rs.mail.ru', 'video-ad.mail.ru',
      'mradx.net', 'ad.adriver.ru', 'adriver.ru', 'content.adriver.ru', 'ssp.adriver.ru', 'vk-portal.net',
      'adman.pro', 'adman.ru', 'mediax.ru', 'rbth.com', 'begun.ru',

      // Global Ad Networks & Exchangers
      'criteo.com', 'static.criteo.net', 'bidder.criteo.com',
      'taboola.com', 'cdn.taboola.com', 'trc.taboola.com',
      'outbrain.com', 'widgets.outbrain.com', 'log.outbrain.com',
      'popads.net', 'serve.popads.net',
      'adsterra.com', 'propellerads.com', 'propellerpush.com',
      'mgid.com', 'servserv.mgid.com', 'jsc.mgid.com',
      'exoclick.com', 'syndication.exoclick.com', 'ads.exoclick.com',
      'trafficjunky.com', 'trafficjunky.net', 'ads.trafficjunky.net',
      'clickadu.com', 'clickadu.net', 'adkeeper.co.uk', 'marketgid.com', 'recreativ.ru',
      'medianet.com', 'contextweb.com', 'adnxs.com', 'ib.adnxs.com',
      'rubiconproject.com', 'fastlane.rubiconproject.com',
      'pubmatic.com', 'ads.pubmatic.com', 'openx.net', 'us-u.openx.net',
      'casalemedia.com', 'adform.net', 'track.adform.net',
      'adroll.com', 'd.adroll.com', 'bidswitch.net', 'x.bidswitch.net',
      'zergnet.com', 'smartadserver.com', 'diff.smartadserver.com',
      'exponential.com', 'undertone.com', 'teads.tv', 'a.teads.tv',
      'adcolony.com', 'inmobi.com', 'applovin.com', 'vungle.com',
      'ironsrc.com', 'chartboost.com', 'fyber.com', 'unityads.unity3d.com',

      // Video Ad Networks & Streaming Player Ad Servers (VK Video, Kodik, Alloha, VideoCDN, Sibnet, Anime streaming)
      'videonow.ru', 'viqeo.tv', 'buzzoola.com', 'moevideo.biz', 'moevideo.net', 'moevideo.club',
      'adtarget.me', 'digitaltarget.ru', 'admixer.net', 'videoroll.net', 'advmaker.net', 'advmaker.ru',
      'adspect.io', 'clickcash.ru', 'traffim.com', 'dt00.net', 'dt01.net', 'dt02.net', 'dt03.net', 'dt04.net', 'dt05.net',
      'aniview.com', 'aniview.tv', 'hyperad.ru', 'luxup.ru', 'betweenx.com', 'rtb.hybrid.ai', 'adman.pro', 'adrun.ru',
      'bidvol.com', 'rtb.adx1.com', 'adkernel.com', 'videoseed.ru', 'advideo.ru', 'vrtcal.com',
      'spotxchange.com', 'spotx.tv', 'springserve.com', 'tremorhub.com', 'synacor.com',
      'smartyads.com', 'selectmedia.asia', 'seedr.com', 'rutarget.ru', 'relap.io',
      'onclickalgo.com', 'onclickprediction.com', 'onclickperformance.com', 'onclicksuper.com',
      'onclkds.com', 'medialand.ru', 'native.ad', 'adngin.com', 'adcombo.com',
      'allohaplayer.com', 'streamguard.cc', 'streamguard.to', 'delivembed.cc', 'voidboost.net',
      'vidverto.io', 'targetvideo.com', 'vidsy.tv', 'cdn-ad.net', 'adhigh.net', 'adspyglass.com',
      'adtraf.com', 'clickaine.com', 'popcash.net', 'adzerk.net', 'showheroes.com',
      'trvdp.com', 'streamrail.com', 'streamrail.net', 'playwire.com', 'intergi.com', 'gorillanation.com',
      'evolvemediallc.com', 'underdogmedia.com', 'adblade.com', 'yieldmo.com', 'gumgum.com',
      'sharethrough.com', 'sonobi.com', 'sovrn.com', 'lijit.com', 'tribalfusion.com', '33across.com',
      'districtm.io', 'districtm.ca', 'primis.tech', 'unruly.co', 'innovid.com', 'flashtalking.com',
      'ssp.adriver.ru', 'adstat.top', 'adtrue.com', 'trafficstars.com', 'hilltopads.net',
      'clickb2b.com', 'octoclick.com', 'monetag.com', 'galaksion.com', 'da-ads.com', 'admobisec.com',
      'traffmag.com', 'adlook.me', 'vmg.host', 'biddingx.com', 'adlookr.com', 'alfasense.com',
      'buzzclick.ru', 'advertur.ru', 'kadam.net', 'kadam.ru', 'medianation.ru', 'rtbhouse.com',
      'adlooxtracking.com', 'doubleverify.com', 'iasds01.com', 'integralads.com',
      'moatads.com', 'moat.com', 'adsafeprotected.com', 'connatix.com', 'minute.ly',
      'brid.tv', 'playstream.media', 'instreamatic.com', 'anyclip.com', 'imasdk.googleapis.com',

      // Gambling, 1xBet, Casino & Shady Redirects
      '1xbet.com', '1x-bet.com', '1xstavka.ru', 'vavada.com', 'catcasino.com', 'up-x.com', 'upx.city',
      'refpa.top', 'refpa1.top', 'refpa2.top', 'refpa3.top', 'ref-pa.top', 'refbanner.com',
      'vulkan.bet', 'vulkan-casino.com', 'joycasino.com', 'pin-up.casino', 'pin-up.bet',
      'mostbet.com', 'melbet.com', 'azino777.com', 'spinbetter.com', '1win.pro', '1win.com', '1-win.com',
      'bitmedia.io', 'a-ads.com', 'coinad.com', 'coinzilla.com',
      'adshares.net', 'richpush.co', 'evadav.com', 'rollerads.com',

      // Trackers, Telemetry & Session Recorders
      'hotjar.com', 'static.hotjar.com', 'script.hotjar.com',
      'clarity.ms', 'www.clarity.ms', 'c.clarity.ms',
      'segment.io', 'api.segment.io', 'cdn.segment.com',
      'mixpanel.com', 'api.mixpanel.com',
      'scorecardresearch.com', 'sb.scorecardresearch.com',
      'quantserve.com', 'edge.quantserve.com',
      'gemius.pl', 'gstat.gemius.pl',
      'tns-counter.ru', 'counter.yadro.ru', 'top100.rambler.ru', 'top100-images.rambler.ru'
    ]);

    // Fast sub-string / regex pattern rules (Safe & targeted)
    this.blockedPatterns = [
      /\/pagead\//i,
      /\/adsbygoogle/i,
      /\/adservice\./i,
      /\/googletagservices\./i,
      /\/gpt\/pubads/i,
      /\/yabs\//i,
      /\/yabs\.yandex\./i,
      /\/an\.yandex\./i,
      /\/direct\.yandex\./i,
      /\/yandexadexchange\./i,
      /\/awaps\.yandex\./i,
      /\/adfox\./i,
      /\/adfox\.ru\//i,
      /\/banners\.adfox\./i,
      /\/ads\.adfox\./i,
      /\/dsp\.yandex\./i,
      /\/bs\.yandex\./i,
      /\/context\.js(\?|$)/i,
      /\/system\/context\.js/i,
      /\/context_static\//i,
      /\/yandex\.ru\/ads\//i,
      /\/yandex\.ru\/clck\//i,
      /\/yandex\.ru\/showad/i,
      /\/yandex_rtb_/i,
      /\/ya-direct/i,
      /\/direct-item/i,
      /\/ad\.adriver\.ru/i,
      /\/ssp\.adriver\.ru/i,
      /\/begun\.ru/i,
      /\/mc\.yandex\.ru\/metrika\//i,
      
      // VK Video Ads & Endpoints
      /\/al_video\.php\?.*act=(get_video_ads|video_ads|get_ad_info)/i,
      /\/act=get_video_ads/i,
      /\/act=get_ad_info/i,
      /\/act=video_ads/i,
      /\/al_ads\.php/i,
      /\/ads_rotator\.php/i,
      /\/adman_/i,

      // VAST / VPAID / Streaming Video Ads (Targeted word-bounded patterns)
      /(?:^|\/)(?:vast|vpaid|preroll|midroll|postroll)(?:[\/?._]|$)/i,
      /\/kodikcdn\.com\/adv\//i,
      /\/allohacdn\.com\/ad\//i,
      /\/ima3.*\.js/i,
      /\/imasdk/i,
      /\/prebid.*\.js/i
    ];
  }

  init(mainWindow) {
    this.mainWindow = mainWindow;
    const settings = storage.getSettings();
    this.enabled = settings.adBlockerEnabled !== false;
    this.totalBlocked = storage.getAdBlockStats()?.totalBlocked || 0;

    this.registerWebRequestFilter();
  }

  registerWebRequestFilter() {
    this.attachSessionFilter(session.defaultSession);
    try {
      this.attachSessionFilter(session.fromPartition('incognito'));
    } catch (e) {}
  }

  attachSessionFilter(ses) {
    if (!ses || !ses.webRequest) return;

    ses.webRequest.onBeforeRequest((details, callback) => {
      try {
        if (!this.enabled) {
          return callback({ cancel: false });
        }

        const url = details.url || '';
        const wcId = details.webContentsId;
        const resourceType = details.resourceType || '';

        // Never block internal browser protocols
        if (url.startsWith('eclipse://') || url.startsWith('blackhole://') || url.startsWith('chrome://') || url.startsWith('devtools://') || url.startsWith('file://')) {
          return callback({ cancel: false });
        }

        // Check if current tab domain is whitelisted
        const initiator = details.initiator || details.referrer || '';
        let domain = '';
        try {
          if (initiator) domain = new URL(initiator).hostname.toLowerCase();
        } catch (e) {}

        if (domain && storage.isDomainWhitelisted(domain)) {
          return callback({ cancel: false });
        }

        // Check URL against Ad Block database
        if (this.shouldBlockUrl(url, resourceType)) {
          this.recordBlock(wcId, url, domain);
          // Cleanly cancel the request with ERR_BLOCKED_BY_CLIENT.
          // Never redirect cross-origin subresources or media to data: URIs,
          // which violates CORS and crashes Chromium NetworkService.
          return callback({ cancel: true });
        }

        return callback({ cancel: false });
      } catch (err) {
        return callback({ cancel: false });
      }
    });
  }

  shouldBlockUrl(url, resourceType = '') {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      const pathname = urlObj.pathname.toLowerCase();

      // 0. High-priority whitelist for subtitles, captions, and transcripts (YouTube & media players)
      if (pathname.includes('/timedtext') || pathname.includes('/transcript') || url.includes('timedtext') || pathname.endsWith('.vtt') || pathname.endsWith('.srt')) {
        return false;
      }

      // 1. Whitelist all official first-party Google, YouTube, and GStatic services
      if (hostname.endsWith('.google.com') || hostname === 'google.com' ||
          hostname.endsWith('.youtube.com') || hostname === 'youtube.com' ||
          hostname.endsWith('.youtu.be') || hostname === 'youtu.be' ||
          hostname.endsWith('.googlevideo.com') || hostname === 'googlevideo.com' ||
          hostname.endsWith('.googleusercontent.com') || hostname === 'googleusercontent.com' ||
          hostname.endsWith('.googleapis.com') || hostname === 'googleapis.com' ||
          hostname.endsWith('.gstatic.com') || hostname === 'gstatic.com' ||
          hostname.endsWith('.ggpht.com') || hostname === 'ggpht.com' ||
          hostname.endsWith('.ytimg.com') || hostname === 'ytimg.com' ||
          hostname.endsWith('.youtube-nocookie.com') || hostname === 'youtube-nocookie.com' ||
          hostname.endsWith('.google.ru') || hostname === 'google.ru' ||
          hostname.endsWith('.1e100.net') || hostname.endsWith('.gvt1.com')) {
        // Block only explicit third-party ad delivery endpoints on Google/YouTube domains
        if (hostname === 'googleads.g.doubleclick.net' || hostname === 'pagead2.googlesyndication.com' || hostname === 'pagead2.googleadservices.com' || hostname === 'adservice.google.com') {
          return true;
        }
        return false;
      }

      // 2. Whitelist Yandex translation, OCR, dictionaries, and core services
      if (hostname.includes('translate.yandex.') || hostname.includes('ocr.yandex.') ||
          hostname.includes('translate-photo.yandex.') || hostname === 'yandex.net' ||
          hostname.endsWith('.yandex.net') || hostname === 'yastatic.net' ||
          hostname.endsWith('.yastatic.net')) {
        // Only block explicit Yandex Ad endpoints
        if (hostname.includes('an.yandex.') || hostname.includes('yabs.yandex.') ||
            hostname.includes('adfox.') || hostname.includes('awaps.yandex.') ||
            hostname.includes('direct.yandex.') || pathname.includes('/context.js') ||
            pathname.includes('/direct/')) {
          return true;
        }
        return false;
      }

      // 3. Whitelist security challenges, OAuth/Auth services, Anti-bot, Captchas & Anime sites & Gamma AI
      if (hostname.includes('gamma.app') || hostname.includes('clerk.com') || hostname.includes('clerk.gamma.app') ||
          hostname.includes('riotgames.com') || hostname.includes('riotcdn.net') || hostname.includes('leagueoflegends.com') ||
          hostname.includes('arkoselabs.com') || hostname.includes('datadome.co') ||
          hostname.includes('ggsel.net') || hostname.includes('ggsel.com') ||
          hostname.includes('yummyanime.tv') || hostname.includes('yummyani.me') ||
          hostname.includes('shikimori.one') || hostname.includes('shikimori.me') ||
          hostname.includes('animego.org') || hostname.includes('animego.me') ||
          hostname.includes('vchecks.me') || hostname.includes('qrator.') || hostname.includes('smartcaptcha.') ||
          hostname.includes('servicepipe.') || hostname.includes('challenges.cloudflare.com') ||
          hostname.includes('hcaptcha.com') || hostname.includes('recaptcha.net') ||
          hostname.includes('fp.hybrid.ai') || hostname.includes('dss.hybrid.ai')) {
        return false;
      }

      // 4. Critical safety guard for media streaming (video/audio chunks)
      // If resource is media (e.g. video segments, audio), NEVER block it unless the host itself is explicitly an ad network
      if (resourceType === 'media') {
        if (this.blockedDomains.has(hostname)) return true;
        for (const blocked of this.blockedDomains) {
          if (hostname.endsWith('.' + blocked)) return true;
        }
        return false;
      }

      // 5. Protect legitimate image and poster resources from over-zealous path blocking
      const isImageResource = pathname.endsWith('.jpg') || pathname.endsWith('.jpeg') ||
                              pathname.endsWith('.png') || pathname.endsWith('.webp') ||
                              pathname.endsWith('.avif') || pathname.endsWith('.gif') ||
                              pathname.endsWith('.svg') || pathname.endsWith('.ico');
      if (isImageResource) {
        let isExplicitAdNetwork = this.blockedDomains.has(hostname);
        if (!isExplicitAdNetwork) {
          for (const blocked of this.blockedDomains) {
            if (hostname.endsWith('.' + blocked)) {
              isExplicitAdNetwork = true;
              break;
            }
          }
        }
        if (!isExplicitAdNetwork) {
          return false;
        }
      }

      // 6. Direct domain check
      if (this.blockedDomains.has(hostname)) {
        return true;
      }

      // 7. Suffix / Subdomain check (e.g. ad.doubleclick.net -> doubleclick.net)
      for (const blocked of this.blockedDomains) {
        if (hostname.endsWith('.' + blocked)) {
          return true;
        }
      }

      // 8. Never block main frame navigation via pattern rules
      if (resourceType === 'mainFrame') {
        return false;
      }

      // 9. Pattern / Path check
      for (const pattern of this.blockedPatterns) {
        if (pattern.test(url)) {
          return true;
        }
      }
    } catch (e) {}

    return false;
  }

  recordBlock(wcId, url, domain) {
    this.totalBlocked++;
    storage.incrementAdBlockStats(1);

    if (wcId) {
      const cur = this.tabStats.get(wcId) || 0;
      this.tabStats.set(wcId, cur + 1);
      this.notifyTabStatsThrottled(wcId);
    }
  }

  notifyTabStatsThrottled(wcId) {
    if (!wcId) return;
    this._notifyTimeouts = this._notifyTimeouts || new Map();
    if (this._notifyTimeouts.has(wcId)) return;

    const timeout = setTimeout(() => {
      if (this._notifyTimeouts) this._notifyTimeouts.delete(wcId);
      const count = this.tabStats.get(wcId) || 0;
      this.notifyTabStats(wcId, count);
    }, 250);

    this._notifyTimeouts.set(wcId, timeout);
  }

  notifyTabStats(wcId, count) {
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('adblock-tab-stats-updated', {
          webContentsId: wcId,
          count: count || 0,
          totalBlocked: this.totalBlocked
        });
      }
    });
  }

  getTabBlockedCount(wcId) {
    return this.tabStats.get(wcId) || 0;
  }

  resetTabStats(wcId) {
    if (wcId) {
      this.tabStats.set(wcId, 0);
      this.notifyTabStats(wcId, 0);
    }
  }

  toggle(enable) {
    this.enabled = typeof enable === 'boolean' ? enable : !this.enabled;
    storage.updateSettings({ adBlockerEnabled: this.enabled });
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('adblock-state-changed', {
          enabled: this.enabled,
          totalBlocked: this.totalBlocked
        });
      }
    });
    return this.enabled;
  }

  toggleWhitelist(domain) {
    const isWhitelisted = storage.toggleAdBlockWhitelist(domain);
    return isWhitelisted;
  }

  getStatusForDomain(domain, wcId) {
    const cleanDomain = (domain || '').replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
    const isWhitelisted = storage.isDomainWhitelisted(cleanDomain);
    const tabBlocked = wcId ? (this.tabStats.get(wcId) || 0) : 0;

    return {
      enabled: this.enabled,
      isWhitelisted,
      domain: cleanDomain,
      tabBlocked,
      totalBlocked: this.totalBlocked
    };
  }
}

module.exports = new AdBlocker();
