"""
Duble do akatsuki-pp-py, para o teste do worker exercitar o protocolo de
verdade sem depender da lib compilada estar instalada.

Entra no lugar da lib real por PYTHONPATH (ver pythonWorker.test.js). O que
importa aqui nao e calcular nada certo, e sim devolver um numero IDENTIFICAVEL:

  pp        = tamanho do .osu recebido  -> prova que o corpo chegou inteiro
  stars     = mods do pedido            -> prova que o cabecalho certo chegou
  max_combo = n100 do pedido

Com isso, uma resposta entregue ao pedido errado aparece no assert em vez de
passar despercebida.

`mods == 666` levanta excecao: e como o teste verifica que a falha de UM pedido
nao derruba o worker inteiro.
"""


class _Difficulty:
    def __init__(self, stars, max_combo):
        self.stars = stars
        self.max_combo = max_combo


class _Resultado:
    def __init__(self, pp, stars, max_combo):
        self.pp = pp
        self.difficulty = _Difficulty(stars, max_combo)


class Beatmap:
    # O nome do argumento e `bytes` porque e assim que a lib real o chama.
    def __init__(self, bytes):
        self.tamanho = len(bytes)


class Calculator:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

    def performance(self, beatmap):
        mods = self.kwargs.get("mods", 0)
        if mods == 666:
            raise ValueError("mapa problematico")

        return _Resultado(
            pp=float(beatmap.tamanho),
            stars=float(mods),
            max_combo=int(self.kwargs.get("n100", -1)),
        )
