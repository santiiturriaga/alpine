"""Exercise customization, riding, sledding, and saved gear through the normal menus."""
import argparse
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

args=argparse.ArgumentParser()
args.add_argument('--url',default='http://127.0.0.1:8080/')
args.add_argument('--screenshots',type=Path)
args.add_argument('--touch',action='store_true')
cfg=args.parse_args()
with sync_playwright() as pw:
    b=pw.chromium.launch(channel='chrome',args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--num-raster-threads=2'])
    size={'width':390,'height':844} if cfg.touch else {'width':1100,'height':760}
    p=b.new_page(viewport=size,has_touch=cfg.touch,is_mobile=cfg.touch,reduced_motion='reduce')
    p.set_default_timeout(60000)
    errors=[]
    def report_error(error):
        errors.append(str(error))
        print('Browser error:', error, flush=True)
    p.on('pageerror', report_error)
    p.on('console',lambda m:report_error(m.text) if m.type=='error' else None)
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
        try:
            node.wait_for(state='visible',timeout=150000)
        except Exception:
            print(p.url, p.locator('#load-status').text_content(), errors, flush=True)
            raise
        (node.tap if cfg.touch else node.click)()
    press('#menu-customize')
    studio=p.locator('#character-customizer')
    expect(studio).to_be_visible()
    press('#character-customizer [data-slot="backpack"]')
    press('[data-item="soelden-22"]')
    press('[data-item="#694e42"][data-group="backpackColor"]')
    press('#character-customizer [data-slot="goggles"]')
    press('.customizer-goggle-view')
    expect(studio.locator('.customizer-stage canvas')).to_have_attribute('aria-label', re.compile('^3D close-up'))
    press('[data-item="red-amber"]')
    press('.customizer-goggle-view')
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
    press('#pause-tab-rider')
    press('#pause-customize')
    press('#character-customizer [data-slot="backpack"]')
    expect(studio.locator('[data-item="soelden-22"]')).to_have_attribute('aria-pressed','true')
    press('.customizer-back')
    expect(p.locator('#pause-customize')).to_be_focused()
    press('#pause-tab-graphics')
    blur = p.locator('#pause-motion-blur')
    expect(blur).to_be_disabled()
    p.emulate_media(reduced_motion='no-preference')
    expect(blur).to_be_checked()
    def moving_snow():
        return p.evaluate("""async () => {
          const {bindSnowCrystals,updateSnowShutter}=await import(new URL('src/snow-crystals.js',document.baseURI));
          const shader={uniforms:{},fragmentShader:'#include <common>'};
          bindSnowCrystals(shader);
          updateSnowShutter({speed:26,vel:{x:26,z:0}},true);
          return shader.uniforms.snowShutter.value.toArray();
        }""")
    assert moving_snow()[0] > 0
    blur.uncheck()
    assert moving_snow() == [0,0,1]
    assert p.evaluate("localStorage.getItem('alpine.snow-motion-blur')") == 'off'
    p.locator('#pause-resolution').focus()
    p.keyboard.press('r')
    expect(p.locator('#pause-tab-graphics')).to_be_visible()
    press('#pause-tab-resort')
    press('#pause-panel-resort [data-destination-open]')
    expect(p.locator('#destination-selector')).to_be_visible()
    press('#destination-close')
    expect(p.locator('#pause-panel-resort [data-destination-open]')).to_be_focused()
    press('#resume')
    if not cfg.touch:
        p.keyboard.press('l')
        expect(studio).to_be_visible()
        press('.customizer-back')
    if cfg.touch:press('[data-ski-action="openMountain"]')
    else:p.keyboard.press('g')
    press('#mountain-tab-profile')
    press('#mountain-outfitter')
    expect(studio).to_be_visible()
    press('.customizer-back')
    expect(p.locator('#mountain-outfitter')).to_be_focused()
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
    assert moving_snow() == [0,0,1]
    press('#character-customizer [data-slot="snowboard"]')
    expect(studio.locator('[data-item="jones-flagship"]')).to_have_attribute('aria-pressed','true')
    print('PASS',mode,'title / equip / first drop / pause / fullscreen sled / return / reload',rider,errors,flush=True)
    assert not errors,errors
    b.close()
