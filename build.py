"""Rebuilds public/index.html from src/ (only needed if you edit the page). Usage: python3 build.py"""
import json, os
here = os.path.dirname(os.path.abspath(__file__))
rd = lambda p: open(os.path.join(here, p), encoding='utf-8').read()
t = rd('src/client_template.html').replace('/*__CSS__*/', rd('src/client_css.txt'))
t = t.replace('/*__ASSETS__*/', 'const ASSETS = ' + json.dumps(json.load(open(os.path.join(here, 'src/assets.json')))) + ';').replace('/*__ENGINE__*/', rd('engine.js'))
open(os.path.join(here, 'public/index.html'), 'w', encoding='utf-8').write(t)
print('built public/index.html', round(len(t) / 1024), 'KB')
