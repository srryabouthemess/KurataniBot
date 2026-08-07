#!/usr/bin/env python3
"""
pp_calc.py - Calculador de PP (algoritmo Akatsuki/oppai-2019) para o KurataniBot
Uso: python pp_calc.py <beatmap_id> <mods_bits> <n300> <n100> <n50> <nmiss> <combo>

O conteúdo do arquivo .osu é lido da ENTRADA PADRÃO (stdin), não baixado aqui.
Antes este script fazia o próprio download, o que contornava o rate limiter e o
cache de mapas do bot: cada cálculo de RX gerava uma requisição extra e não
controlada a osu.ppy.sh, arriscando throttling/ban do IP. Agora o Node envia os
bytes que já tem em cache.

Valores -1 indicam "não disponível":
  n300/n100/n50 = -1  → akatsuki-pp-py assume SS
  combo         = -1  → usa max_combo do mapa (FC)

Imprime no stdout um JSON com os atributos calculados:
  {"pp": 247.1847, "stars": 4.6353, "max_combo": 730}
ou `null` em caso de erro.

O star rating vem do mesmo algoritmo que calculou o PP e já considera os
mods — por isso é preferível ao difficulty_rating da API oficial, que é
sempre o valor sem mods.

Requer: pip install akatsuki-pp-py (use Python <= 3.11, veja o README)
"""

import sys
import json
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
        # O Node envia o .osu por stdin (já veio do cache dele).
        osu_bytes = sys.stdin.buffer.read()
        if not osu_bytes:
            sys.stderr.write(f"stdin vazio para o mapa {beatmap_id}\n")
            print("null")
            return

        # Salva em arquivo temporário — forma mais compatível com akatsuki-pp-py
        tmp = tempfile.NamedTemporaryFile(suffix='.osu', delete=False)
        tmp.write(osu_bytes)
        tmp.close()

        try:
            beatmap = Beatmap(path=tmp.name)

            calc_kwargs = {"mods": mods}

            if n300 >= 0 and n100 >= 0 and n50 >= 0:
                # Modo FC: hits reais conhecidos, misses são mesclados ao n300
                # para estimar o PP "se tivesse sido FC" (usado por getFCpp).
                calc_kwargs["n300"]     = n300 + nmiss
                calc_kwargs["n100"]     = n100
                calc_kwargs["n50"]      = n50
                calc_kwargs["n_misses"] = 0
            else:
                # Modo simulação: n300 desconhecido (a lib completa
                # automaticamente com o restante dos objetos do mapa), misses
                # contam como misses reais.
                if n100 >= 0: calc_kwargs["n100"] = n100
                if n50  >= 0: calc_kwargs["n50"]  = n50
                calc_kwargs["n_misses"] = nmiss

            if combo >= 0:
                calc_kwargs["combo"] = combo

            calc   = Calculator(**calc_kwargs)
            result = calc.performance(beatmap)
            print(json.dumps({
                "pp":        round(result.pp, 4),
                "stars":     round(result.difficulty.stars, 4),
                "max_combo": result.difficulty.max_combo,
            }))

        finally:
            os.unlink(tmp.name)

    except Exception as e:
        sys.stderr.write(f"Erro: {e}\n")
        print("null")

if __name__ == "__main__":
    main()
