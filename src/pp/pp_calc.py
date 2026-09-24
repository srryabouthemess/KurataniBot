#!/usr/bin/env python3
"""
pp_calc.py - worker de calculo de PP (algoritmo Akatsuki/oppai-2019) do KurataniBot

Antes isto era um script de uma tacada so: o Node dava um `spawn` por play,
mandava os parametros pela linha de comando e lia o resultado. Funcionava, e
custava um interpretador inteiro por numero -- medido so o spawn + startup, SEM
importar a lib: 44ms por chamada (Windows; na VPS Linux e menor). Uma pagina de
/topplays de RX sao cinco.

Agora o processo fica de pe e atende requisicoes em sequencia. O protocolo e uma
linha de JSON por pedido, seguida dos bytes do arquivo .osu:

  <- {"id": 1, "map_id": 123, "bytes": 51234, "mods": 64,
      "n300": -1, "n100": 0, "n50": 0, "nmiss": 0, "combo": -1}\n
  <- <exatamente 51234 bytes do .osu, logo apos o \n>
  -> {"id": 1, "pp": 247.1847, "stars": 4.6353, "max_combo": 730}\n

O `id` volta na resposta porque o Node pode ter varios pedidos em voo (uma
pagina sao cinco plays); e ele que casa cada resposta com quem esperava.

O stdout carrega SO respostas, uma por linha -- todo diagnostico vai para o
stderr, senao entraria no meio do protocolo.

Falha de UM pedido responde {"id": 1, "error": "..."} e o worker continua de pe:
um mapa problematico nao pode derrubar o calculo dos outros. O que derruba e
falta da lib ou fluxo dessincronizado -- ai o processo escreve a causa no stderr
e sai, para o Node relatar uma vez e esperar antes de tentar de novo
(ver pythonWorker.js).

Valores -1 continuam significando "nao disponivel":
  n300/n100/n50 = -1  -> akatsuki-pp-py assume SS
  combo         = -1  -> usa max_combo do mapa (FC)

O star rating vem do mesmo algoritmo que calculou o PP e ja considera os mods --
por isso e preferivel ao difficulty_rating da API oficial, que e sempre o valor
sem mods.

Requer: pip install akatsuki-pp-py (use Python <= 3.11, veja o README)
"""

import sys
import json


def read_exact(stream, n):
    """
    Le exatamente `n` bytes, ou None se o stream acabar antes.

    Um `read(n)` so nao basta: em pipe ele pode devolver menos do que foi pedido
    mesmo sem ter acabado, e ai o .osu chegaria truncado -- o que a lib
    aceitaria calculando um mapa pela metade, sem erro nenhum.
    """
    partes = []
    faltam = n
    while faltam > 0:
        pedaco = stream.read(faltam)
        if not pedaco:
            return None
        partes.append(pedaco)
        faltam -= len(pedaco)
    return b"".join(partes)


def responder(stdout, payload):
    stdout.write(json.dumps(payload).encode("utf-8") + b"\n")
    stdout.flush()


def calcular(Beatmap, Calculator, pedido, corpo):
    """Os mesmos parametros do script de uma tacada so, na mesma semantica."""
    beatmap = Beatmap(bytes=corpo)

    mods  = int(pedido.get("mods")  or 0)
    n300  = int(pedido.get("n300",  -1))
    n100  = int(pedido.get("n100",  -1))
    n50   = int(pedido.get("n50",   -1))
    nmiss = int(pedido.get("nmiss") or 0)
    combo = int(pedido.get("combo", -1))

    kwargs = {"mods": mods}

    if n300 >= 0 and n100 >= 0 and n50 >= 0:
        # Modo FC: hits reais conhecidos, misses sao mesclados ao n300 para
        # estimar o PP "se tivesse sido FC" (usado pelo getFCpp).
        kwargs["n300"]     = n300 + nmiss
        kwargs["n100"]     = n100
        kwargs["n50"]      = n50
        kwargs["n_misses"] = 0
    else:
        # Modo simulacao: n300 desconhecido (a lib completa automaticamente com
        # o restante dos objetos do mapa), misses contam como misses reais.
        if n100 >= 0:
            kwargs["n100"] = n100
        if n50 >= 0:
            kwargs["n50"] = n50
        kwargs["n_misses"] = nmiss

    if combo >= 0:
        kwargs["combo"] = combo

    resultado = Calculator(**kwargs).performance(beatmap)
    return {
        "pp":        round(resultado.pp, 4),
        "stars":     round(resultado.difficulty.stars, 4),
        "max_combo": resultado.difficulty.max_combo,
    }


def main():
    try:
        from akatsuki_pp_py import Beatmap, Calculator
    except ImportError:
        # Sair, em vez de responder erro a cada pedido: a causa e permanente
        # naquela instalacao, e o Node so precisa ouvi-la uma vez.
        sys.stderr.write("akatsuki-pp-py nao instalado. Execute: pip install akatsuki-pp-py\n")
        sys.stderr.flush()
        return 1

    stdin  = sys.stdin.buffer
    stdout = sys.stdout.buffer

    while True:
        linha = stdin.readline()
        if not linha:
            return 0  # o Node fechou o stdin: fim normal

        try:
            pedido = json.loads(linha)
        except ValueError:
            # Sem o cabecalho nao da para saber o id nem quantos bytes de corpo
            # pular, entao o fluxo esta dessincronizado e nada depois dele e
            # confiavel. Sair e o unico jeito honesto; o Node sobe outro.
            sys.stderr.write("cabecalho ilegivel; encerrando para o Node reiniciar\n")
            sys.stderr.flush()
            return 1

        rid = pedido.get("id")

        n_bytes = int(pedido.get("bytes") or 0)
        corpo = read_exact(stdin, n_bytes) if n_bytes > 0 else b""
        if corpo is None:
            sys.stderr.write("stdin acabou no meio do corpo do pedido\n")
            sys.stderr.flush()
            return 1

        if not corpo:
            responder(stdout, {
                "id": rid,
                "error": "corpo vazio para o mapa {}".format(pedido.get("map_id")),
            })
            continue

        try:
            resposta = calcular(Beatmap, Calculator, pedido, corpo)
            resposta["id"] = rid
            responder(stdout, resposta)
        except Exception as e:
            # Mapa problematico responde erro e a fila segue -- derrubar o
            # worker aqui puniria as outras plays da mesma pagina.
            responder(stdout, {"id": rid, "error": str(e)})


if __name__ == "__main__":
    sys.exit(main())
