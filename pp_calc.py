#!/usr/bin/env python3
"""
pp_calc.py - Calculador de FC PP para o KurataniBot
Uso: python pp_calc.py <beatmap_id> <mods_bits> <n300> <n100> <n50> <nmiss> <combo>

Valores -1 indicam "não disponível":
  n300/n100/n50 = -1  → akatsuki-pp-py assume SS
  combo         = -1  → usa max_combo do mapa (FC)

Retorna apenas o valor de PP no stdout, ou "null" em caso de erro.
Requer: pip install akatsuki-pp-py
"""

import sys
import urllib.request
import tempfile
import os

def main():
    if len(sys.argv) != 8:
        print("null")
        return

    try:
        beatmap_id = int(sys.argv[1])
        mods       = int(sys.argv[2])
        n300       = int(sys.argv[3])
        n100       = int(sys.argv[4])
        n50        = int(sys.argv[5])
        nmiss      = int(sys.argv[6])
        combo      = int(sys.argv[7])
    except ValueError:
        print("null")
        return

    try:
        from akatsuki_pp_py import Beatmap, Calculator
    except ImportError:
        sys.stderr.write("akatsuki-pp-py nao instalado. Execute: pip install akatsuki-pp-py\n")
        print("null")
        return

    try:
        url = f"https://osu.ppy.sh/osu/{beatmap_id}"
        with urllib.request.urlopen(url, timeout=8) as response:
            osu_bytes = response.read()

        # Salva em arquivo temporário — forma mais compatível com akatsuki-pp-py
        tmp = tempfile.NamedTemporaryFile(suffix='.osu', delete=False)
        tmp.write(osu_bytes)
        tmp.close()

        try:
            beatmap = Beatmap(path=tmp.name)

            calc_kwargs = {
                "mods":     mods,
                "n_misses": 0,
            }

            if n300 >= 0 and n100 >= 0 and n50 >= 0:
                calc_kwargs["n300"] = n300 + nmiss
                calc_kwargs["n100"] = n100
                calc_kwargs["n50"]  = n50

            if combo >= 0:
                calc_kwargs["combo"] = combo

            calc   = Calculator(**calc_kwargs)
            result = calc.performance(beatmap)
            print(f"{result.pp:.4f}")

        finally:
            os.unlink(tmp.name)

    except Exception as e:
        sys.stderr.write(f"Erro: {e}\n")
        print("null")

if __name__ == "__main__":
    main()
