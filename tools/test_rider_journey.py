"""Exercise customization, riding, sledding, and saved gear through the normal menus."""
import argparse
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

args=argparse.ArgumentParser()
args.add_argument('--url',default='http://127.0.0.1:8080/')
args.add_argument('--screenshots',type=Path)
args.add_argument('--touch',action='store_true')
cfg=args.parse_args()
with sync_playwright() as pw:
    b=pw.chromium.launch(channel='chrome',args=['--disable-gpu','--disable-gpu-compositing','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    size={'width':390,'height':844} if cfg.touch else {'width':1100,'height':760}
    p=b.new_page(viewport=size,has_touch=cfg.touch,is_mobile=cfg.touch,reduced_motion='reduce')
    p.set_default_timeout(60000)
    errors=[]
    p.on('pageerror',lambda e:errors.append(str(e)))
    p.on('console',lambda m:errors.append(m.text) if m.type=='error' and 'Shader Error' in m.text else None)
    p.add_init_script("localStorage.setItem('alpine.multiplayer','off')")
    mode='touch' if cfg.touch else 'desktop'
    def capture(name):
        if cfg.screenshots:
            cfg.screenshots.mkdir(parents=True,exist_ok=True)
            p.screenshot(path=cfg.screenshots/(mode+'-'+name+'.png'),timeout=60000)
    url=cfg.url.rstrip('/')+'/?mountain=stevens-pass&quality=budget&resolution=480p&time=day'
    p.goto(url,wait_until='domcontentloaded',timeout=90000)
    def press(selector):
        node=p.locator(selector).first
        node.wait_for(state='visible',timeout=150000)
        (node.tap if cfg.touch else node.click)()
    press('#menu-customize')
    studio=p.locator('#character-customizer')
    expect(studio).to_be_visible()
    press('#character-customizer [data-slot="backpack"]')
    press('[data-item="soelden-22"]')
    press('[data-item="#694e42"][data-group="backpackColor"]')
    press('#character-customizer [data-slot="goggles"]')
    press('[data-item="red-amber"]')
    press('#character-customizer [data-slot="snowboard"]')
    press('[data-item="jones-flagship"]')
    press('[data-item="goofy"]')
    capture('studio')
    press('.customizer-back')
    expect(p.locator('#menu-customize')).to_be_focused()
    press('#drop-in')
    p.wait_for_function("window.__mappedResort?.state.playing",timeout=120000)
    rider=p.evaluate("""()=>{const {player,renderer}=__mappedResort;const g=renderer.getContext();
    return {adapter:g.getParameter(g.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),
    discipline:player.discipline,model:player.snowboardModel.id,stance:player.stance,
    pack:!!player.rig.group.getObjectByName('Osprey · Soelden 22'),appearance:JSON.parse(localStorage.getItem('alpine.outfitter.v1')).outfit}}""")
    assert 'SwiftShader' in rider['adapter'] and rider['discipline']=='snowboard' and rider['model']=='jones-flagship' and rider['stance']=='goofy' and rider['pack'] and rider['appearance']['goggles']=='red-amber',rider
    if cfg.touch:press('[data-ski-action="pause"]')
    else:p.keyboard.press('Escape')
    press('#pause-customize')
    press('#character-customizer [data-slot="backpack"]')
    expect(studio.locator('[data-item="soelden-22"]')).to_have_attribute('aria-pressed','true')
    press('.customizer-back')
    expect(p.locator('#pause-customize')).to_be_focused()
    press('#resume')
    if cfg.touch:press('[data-ski-action="openMountain"]')
    else:p.keyboard.press('g')
    press('#mountain-tab-activities')
    press('[data-minigame="sled"]')
    press('[data-sled-play]')
    p.wait_for_function("document.querySelector('#sled-game')?.dataset.state==='running'",timeout=60000)
    if cfg.touch:press('[data-sled-input="jump"]')
    else:p.keyboard.press('Space')
    p.wait_for_function("Number(document.querySelector('[data-sled-distance]')?.textContent)>12")
    capture('sled')
    assert not p.locator('.sled-scrim').count()
    assert 'White Fir' not in p.locator('#sled-game').inner_text()
    press('[data-sled-exit]')
    expect(p.locator('[data-minigame="sled"]')).to_be_focused()
    press('#mountain-done')
    p.reload(wait_until='domcontentloaded',timeout=90000)
    press('#menu-customize')
    press('#character-customizer [data-slot="snowboard"]')
    expect(studio.locator('[data-item="jones-flagship"]')).to_have_attribute('aria-pressed','true')
    print('PASS',mode,'title / equip / first drop / pause / fullscreen sled / return / reload',rider,errors,flush=True)
    assert not errors,errors
    b.close()
