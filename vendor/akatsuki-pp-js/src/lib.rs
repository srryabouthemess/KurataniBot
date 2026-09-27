//! O calculo de PP do Akatsuki, do jeito que o servidor faz.
//!
//! Espelha o `src/api/routes/calculate.rs` do osuAkatsuki/performance-service:
//! Relax no osu!std sai do `osu_2019::OsuPP`; todo o resto sai do calculo
//! generico do akatsuki-pp-rs com `lazer(false)`. O RX std do bancho.py do
//! Daycore (docker/akatsuki-rx-py) e o mesmo `osu_2019`, so em outro commit.

use akatsuki_pp::{model::mode::GameMode, osu_2019::OsuPP};
use wasm_bindgen::prelude::*;

const RX: u32 = 1 << 7;

#[wasm_bindgen]
pub struct Beatmap {
    inner: akatsuki_pp::Beatmap,
}

#[wasm_bindgen]
impl Beatmap {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8]) -> Result<Beatmap, JsError> {
        akatsuki_pp::Beatmap::from_bytes(bytes)
            .map(|inner| Self { inner })
            .map_err(|err| JsError::new(&err.to_string()))
    }

    /// Objetos do mapa: o denominador da accuracy quando o n300 nao veio.
    #[wasm_bindgen(getter, js_name = nObjects)]
    pub fn n_objects(&self) -> u32 {
        self.inner.hit_objects.len() as u32
    }
}

/// `[pp, stars, maxCombo]`. Hit ausente e deduzido pelo motor; combo ausente e
/// o maximo do mapa.
///
/// `acc` (0-100) e como o score-service do Akatsuki pede o PP na submissao:
/// accuracy + misses, sem os hits. Com ela, n300/n100/n50 sao ignorados, como
/// o performance-service exige (um OU outro).
#[wasm_bindgen]
pub fn performance(
    map: &Beatmap,
    mods: u32,
    n300: Option<u32>,
    n100: Option<u32>,
    n50: Option<u32>,
    misses: u32,
    combo: Option<u32>,
    acc: Option<f64>,
) -> Vec<f64> {
    let map = &map.inner;

    if mods & RX > 0 && map.mode == GameMode::Osu {
        // O osu_2019 quer os misses antes do resto (ver OsuPP::accuracy).
        let mut calc = OsuPP::from_map(map).mods(mods).misses(misses);
        if let Some(combo) = combo {
            calc = calc.combo(combo);
        }
        if let Some(acc) = acc {
            calc = calc.accuracy(acc as f32);
        } else {
            if let Some(n300) = n300 {
                calc = calc.n300(n300);
            }
            if let Some(n100) = n100 {
                calc = calc.n100(n100);
            }
            if let Some(n50) = n50 {
                calc = calc.n50(n50);
            }
        }

        let attrs = calc.calculate();
        return vec![attrs.pp, attrs.difficulty.stars, attrs.difficulty.max_combo as f64];
    }

    let mut calc = map.performance().mods(mods).lazer(false).misses(misses);
    if let Some(combo) = combo {
        calc = calc.combo(combo);
    }
    if let Some(acc) = acc {
        // O performance-service faz `acc as f64` de um f32: a precisao e a do f32.
        calc = calc.accuracy(acc as f32 as f64);
    } else {
        if let Some(n300) = n300 {
            calc = calc.n300(n300);
        }
        if let Some(n100) = n100 {
            calc = calc.n100(n100);
        }
        if let Some(n50) = n50 {
            calc = calc.n50(n50);
        }
    }

    let attrs = calc.calculate();
    vec![attrs.pp(), attrs.stars(), attrs.max_combo() as f64]
}
