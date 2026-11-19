"""Bake the two weather-independent cloud noise fields used by the Budget sky."""

from pathlib import Path

import numpy as np
from PIL import Image


def fract(value):
    return value - np.floor(value)


def lattice(x, y):
    a, b = fract(x * .1031), fract(y * .1030)
    k = a * (b + 31.32) + b * (a + 31.32)
    return fract((a + k + b + k) * (a + k))


def noise(x, y):
    i, j = np.floor(x), np.floor(y)
    u, v = x - i, y - j
    u, v = u*u*(3-2*u), v*v*(3-2*v)
    a = lattice(i, j) * (1-u) + lattice(i+1, j) * u
    b = lattice(i, j+1) * (1-u) + lattice(i+1, j+1) * u
    return a*(1-v) + b*v


def clouds(x, y):
    total = .54 * noise(x, y)
    for weight, zoom, dx, dy in [(.252, 2.06, 4.1, -1.7), (.132, 2.02, -2.8, 8.3),
                                 (.051, 2.1, 0, 0), (.025, 2.11, 0, 0)]:
        x, y = (.81*x - .586*y) * zoom + dx, (.586*x + .81*y) * zoom + dy
        total += weight * noise(x, y)
    return total


if __name__ == "__main__":
    size = 768
    axis = ((np.arange(size, dtype="float32") + .5) / size - .5) * 32
    x, y = np.meshgrid(axis, axis)
    density = clouds(x + (noise(.69*x+7, .69*y+7)-.5)*.98,
                     y + (noise(.62*x-4, .62*y-4)-.5)*.98) + (noise(.36*x+13.1, .36*y+13.1)-.5)*.23
    # Store the full density interval before weather thresholds (including overshoot).
    fields = np.dstack((clouds(x, y), (density + .125) / 1.25, np.zeros_like(x)))
    pixels = np.rint(np.clip(fields, 0, 1) * 255).astype("uint8")
    dest = Path(__file__).resolve().parents[1] / "assets" / "weather" / "cloud-field.png"
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels).save(dest, optimize=True)
