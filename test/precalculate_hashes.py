# This test generates the 'precaculatedHashes' array in 1.sys.test.ts

import hashlib
import math

def calculate_hash(total_size: int) -> str:
    if total_size >= 20000000:
        divider = math.ceil(total_size / 100000000)
        blocks = []
        for x in range(divider):
            blocks.append({'start': x * 100000000, 'end': (x + 1) * 100000000 - 1})
        blocks[-1]['end'] = min(100000000 * divider, total_size) - 1


        content = b'-' * total_size
        r = hashlib.sha256()
        for block in blocks:
            h = hashlib.sha256()
            h.update(content[block['start']: block['end'] + 1])
            r.update(h.hexdigest().encode('ascii'))

        return r.hexdigest()

    h = hashlib.sha256()
    h.update(b"-" * total_size)
    return h.hexdigest()

def print_hash(i: int, hash: str):
    print(f"        [{i}, '{calculate_hash(i)}'],")


def calculate_and_print_hash(i: int):
    print_hash(i, calculate_hash(i))

print('    const precaculatedHashes = [')
calculate_and_print_hash(0)
calculate_and_print_hash(1)
calculate_and_print_hash(2)
calculate_and_print_hash(10)
calculate_and_print_hash(100)
for x in range(5000, 200000000, 9999999):
    calculate_and_print_hash(x)
calculate_and_print_hash(200000000)
calculate_and_print_hash(200000001)

print('    ]')
