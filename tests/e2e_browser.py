# Optional full-app test in Chromium with a fake Alt1.
# Needs: pip install playwright, then `npm run build` and `npm start` in another window.
import asyncio, base64, json
from playwright.async_api import async_playwright
import os
F=os.path.join(os.path.dirname(os.path.abspath(__file__)),'fixtures')+os.sep
def b64(p): return base64.b64encode(open(p,'rb').read()).decode()
imgs={k:b64(F+v) for k,v in {'chatA':'chat_before_check.png','chatB':'chat_nexus_contents.png','greater':'buffs_greater_60.png','lesser':'buffs_lesser_30.png'}.items()}
MOCK = """
(() => {
  const cnv = document.createElement('canvas'); cnv.width = 1000; cnv.height = 700;
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  const imgs = {};
  window.__overlays = [];
  window.__ready = Promise.all(Object.entries(__IMGS__).map(([k, v]) => new Promise(r => { const i = new Image(); i.onload = () => { imgs[k] = i; r(); }; i.src = 'data:image/png;base64,' + v; })));
  window.__scene = (chat, buffs) => {
    ctx.fillStyle = '#3a3040'; ctx.fillRect(0, 0, 1000, 700);
    if (buffs) ctx.drawImage(imgs[buffs], 600, 40);
    else { ctx.fillStyle = '#2a2230'; ctx.fillRect(600, 40, 200, 80); }
    ctx.drawImage(imgs[chat], 10, 450);
  };
  const grab = (x, y, w, h) => ctx.getImageData(x, y, w, h).data;
  let bound = null;
  window.alt1 = {
    permissionPixel: true, permissionOverlay: true, permissionGameState: true, rsLinked: true, rsActive: true,
    rsWidth: 1000, rsHeight: 700, rsX: 0, rsY: 0, screenX: 0, screenY: 0, screenWidth: 1000, screenHeight: 700,
    versionint: 1006000, maxtranfer: 4000000, skinName: 'default',
    identifyAppUrl() {}, userResize() {},
    capture: (x, y, w, h) => grab(x, y, w, h),
    bindRegion(x, y, w, h) { bound = { x, y, w, h, data: ctx.getImageData(x, y, w, h) }; return 1; },
    bindGetRegionBuffer(hd, x, y, w, h) {
      const out = new Uint8ClampedArray(w * h * 4), s = bound.data;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const si = ((y - bound.y + yy) * s.width + (x - bound.x + xx)) * 4, di = (yy * w + xx) * 4;
        out[di] = s.data[si]; out[di + 1] = s.data[si + 1]; out[di + 2] = s.data[si + 2]; out[di + 3] = s.data[si + 3];
      }
      return out;
    },
    overLaySetGroup() {}, overLayClearGroup() {}, overLayFreezeGroup() {}, overLayRefreshGroup() {},
    overLayTextEx(...a) { window.__overlays.push(a[0]); return true; },
    overLayText(...a) { window.__overlays.push(a[0]); return true; },
    overLayRect() { return true; },
  };
})();
""".replace('__IMGS__', json.dumps(imgs))

async def state(pg):
    return await pg.evaluate("""() => ({
      counts: [...document.querySelectorAll('.item .count')].map(e => e.textContent).join(' | '),
      shield: document.getElementById('shieldline').textContent,
      chat: document.getElementById('st-chat').className, buffs: document.getElementById('st-buffs').className,
      log: [...document.querySelectorAll('#log > div')].map(d => d.textContent).slice(0, 4),
      overlays: window.__overlays.slice(-2) })""")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width":300,"height":640})
        errs=[]
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append("console:"+m.text) if m.type in ("error",) else None)
        await pg.add_init_script("try{ if(!sessionStorage.getItem('c')){localStorage.clear();sessionStorage.setItem('c','1')} }catch(e){}")
        await pg.add_init_script(MOCK)
        await pg.add_init_script("window.__readyP = null;")
        # hold app start until images decode: app polls every 600ms so just set a scene asap
        await pg.goto("http://localhost:7280/")
        await pg.evaluate("window.__ready.then(() => __scene('chatA', 'lesser'))")
        await pg.wait_for_timeout(5000)
        print("1 start (lesser shield already up, old chat):", await state(pg))
        await pg.evaluate("__scene('chatB', 'lesser')")
        await pg.wait_for_timeout(3000)
        print("2 check contents appears:", await state(pg))
        await pg.evaluate("__scene('chatB', null)")
        await pg.wait_for_timeout(8000)
        print("3 shield off (bar empty):", await state(pg))
        await pg.evaluate("__scene('chatB', 'greater')")
        await pg.wait_for_timeout(4000)
        print("4 greater shield on:", await state(pg))
        # simulate being low: set spirit via settings then another shield toggle
        await pg.click('#btn-settings')
        inp = pg.locator('#set-counts input').nth(1)
        await inp.fill('505'); await inp.dispatch_event('change')
        await pg.click('#set-close')
        await pg.evaluate("__scene('chatB', null)"); await pg.wait_for_timeout(8000)
        await pg.evaluate("__scene('chatB', 'greater')"); await pg.wait_for_timeout(3000)
        print("5 toggled again near threshold:", await state(pg))
        await pg.screenshot(path="e2e.png", full_page=True)
        await pg.reload(); await pg.wait_for_timeout(1500)
        print("6 after reload (persistence):", (await state(pg))['counts'])
        print("errors:", errs[:5])
        await b.close()
asyncio.run(main())
