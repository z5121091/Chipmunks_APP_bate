"""Synthetic, in-memory Code128 reprint command checks; no printer access."""

import heapq
import itertools
import re
import unittest

from scripts.label_templates.code128 import (
    _encode_code128_bc,
    build_reprint_barcode_command,
    get_reprint_barcode_width,
)


def decode_manual_content(content):
    """Independently interpret the documented 128M B/C data/control syntax."""
    start = content[:4]
    if start not in ('!104', '!105'):
        raise AssertionError('Missing explicit Code B/C start')
    in_c = start == '!105'
    words = [105 if in_c else 104]
    decoded = []
    index = 4
    while index < len(content):
        if content.startswith('!099', index):
            if in_c:
                raise AssertionError('Code C switch while already in C')
            words.append(99)
            in_c = True
            index += 4
        elif content.startswith('!100', index):
            if not in_c:
                raise AssertionError('Code B switch while already in B')
            words.append(100)
            in_c = False
            index += 4
        elif in_c:
            pair = content[index:index + 2]
            if len(pair) != 2 or not pair.isascii() or not pair.isdigit():
                raise AssertionError('Invalid Code C data pair')
            decoded.append(pair)
            words.append(int(pair))
            index += 2
        else:
            character = content[index]
            if not 32 <= ord(character) <= 126 or character == '!':
                raise AssertionError('Invalid or ambiguous Code B data')
            decoded.append(character)
            words.append(ord(character) - 32)
            index += 1
    return ''.join(decoded), tuple(words)


def shortest_word_count(value):
    """Independent shortest-path oracle with standalone subset-switch edges."""
    queue = [(1, 0, False), (1, 0, True)]
    costs = {}
    while queue:
        cost, index, in_c = heapq.heappop(queue)
        state = (index, in_c)
        if state in costs:
            continue
        costs[state] = cost
        if index == len(value):
            return cost
        heapq.heappush(queue, (cost + 1, index, not in_c))
        if not in_c:
            heapq.heappush(queue, (cost + 1, index + 1, False))
        elif index + 1 < len(value) and value[index:index + 2].isascii() and value[index:index + 2].isdigit():
            heapq.heappush(queue, (cost + 1, index + 2, True))
    raise AssertionError('No Code128 encoding path')


class Code128ReprintCommandTest(unittest.TestCase):
    def command(self, value, right_edge=1000, module_dots=2, field_name='追溯码'):
        return build_reprint_barcode_command(
            value, x=30, y=100, height=32, module_dots=module_dots,
            right_edge=right_edge, field_name=field_name,
        )

    def content(self, command):
        match = re.fullmatch(r'BARCODE \d+,\d+,"128M",\d+,0,0,\d+,\d+,"([^"]*)"', command)
        self.assertIsNotNone(match)
        return match.group(1)

    def test_mixed_long_numeric_run_preserves_two_dot_modules_with_exact_width(self):
        value = 'AB1234567890-1'
        content, words = _encode_code128_bc(value)
        self.assertEqual(content, '!104AB!0991234567890!100-1')
        self.assertEqual((len(words) + 1) * 11 + 13, 156)
        command = self.command(value, right_edge=30 + 312)
        self.assertIn(',2,2,', command)
        self.assertEqual(decode_manual_content(self.content(command))[0], value)
        with self.assertRaisesRegex(ValueError, '追溯码条码宽度312点，模板可用311点，无法完整打印'):
            self.command(value, right_edge=30 + 311)

    def test_even_numeric_input_starts_in_code_c_and_keeps_leading_zeroes(self):
        value = '001234567890'
        content, words = _encode_code128_bc(value)
        self.assertEqual(content, '!105001234567890')
        self.assertEqual((len(words) + 1) * 11 + 13, 101)
        self.assertEqual(decode_manual_content(content), (value, words))

    def test_layout_measurement_uses_the_same_complete_encoding_as_the_command(self):
        for value in ('AB1234567890123-1', 'AB1234567890123-10',
                      'AB1234567890123-100', '001234567890', 'AA!10412345678'):
            with self.subTest(value=value):
                width = get_reprint_barcode_width(value, 2, '追溯码')
                command = self.command(value, right_edge=30 + width)
                if '!' not in value:
                    decoded, words = decode_manual_content(self.content(command))
                    self.assertEqual(decoded, value)
                    self.assertEqual(width, ((len(words) + 1) * 11 + 13) * 2)
                else:
                    self.assertIn('"128"', command)
                    self.assertEqual(width, ((len(value) + 2) * 11 + 13) * 2)
                with self.assertRaisesRegex(ValueError, '追溯码条码宽度'):
                    self.command(value, right_edge=30 + width - 1)

    def test_layout_measurement_rejects_unsafe_input_and_invalid_modules(self):
        for value in ('', None, 'A"B', 'A\nB', 'A\x7fB', '型号'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, '追溯码含无法安全完整打印的字符'):
                get_reprint_barcode_width(value, 2, '追溯码')
        for module in (0, 11, True, 1.5):
            with self.subTest(module=module), self.assertRaisesRegex(ValueError, '追溯码条码打印参数无效'):
                get_reprint_barcode_width('TEST', module, '追溯码')

    def test_odd_numeric_input_has_a_valid_switch_and_preserves_every_digit(self):
        value = '01234567890'
        content, words = _encode_code128_bc(value)
        self.assertEqual(decode_manual_content(content), (value, words))
        self.assertEqual(len(words), shortest_word_count(value))
        self.assertIn('!099', content)

    def test_literal_bang_stays_in_automatic_mode_and_cannot_inject_manual_controls(self):
        value = 'AA!10412345678'
        command = self.command(value, right_edge=30 + 378)
        self.assertEqual(command, 'BARCODE 30,100,"128",32,0,0,2,2,"AA!10412345678"')
        with self.assertRaisesRegex(ValueError, '追溯码条码宽度378点，模板可用377点，无法完整打印'):
            self.command(value, right_edge=30 + 377)

    def test_different_ascii_and_digit_runs_round_trip_and_are_minimal(self):
        examples = ['A', '0', '12', '123', 'ABCD', 'A0012B', 'A000000000000B12C',
                    'A12345678901234567Z', '(),/\\: $+-.*', '123456789012A123456789012']
        for value in examples:
            with self.subTest(value=value):
                content, words = _encode_code128_bc(value)
                self.assertEqual(decode_manual_content(content), (value, words))
                self.assertEqual(len(words), shortest_word_count(value))
                self.assertEqual(decode_manual_content(self.content(self.command(value)))[0], value)

    def test_small_mixed_inputs_match_an_independent_shortest_path_oracle(self):
        for length in range(1, 6):
            for characters in itertools.product('A12', repeat=length):
                value = ''.join(characters)
                content, words = _encode_code128_bc(value)
                self.assertEqual(decode_manual_content(content), (value, words))
                self.assertEqual(len(words), shortest_word_count(value), value)

    def test_printable_ascii_besides_command_quote_and_bang_is_not_truncated(self):
        value = ''.join(chr(code) for code in range(32, 127) if code not in (33, 34))
        command = self.command(value, right_edge=2000, module_dots=1)
        self.assertEqual(decode_manual_content(self.content(command))[0], value)

    def test_unsafe_input_and_invalid_geometry_are_rejected(self):
        for value in ('', 'A"B', 'A\nB', 'A\rB', 'A\tB', 'A\x7fB', '型号', None):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, '追溯码含无法安全完整打印的字符'):
                self.command(value)
        with self.assertRaisesRegex(ValueError, '追溯码内容超过1000字符，无法完整打印'):
            self.command('A' * 1001)
        for kwargs in ({'x': -1}, {'y': -1}, {'height': 0}, {'module_dots': 0},
                       {'module_dots': 11}, {'module_dots': True}, {'right_edge': 29}):
            parameters = dict(value='AB', x=30, y=100, height=32,
                              module_dots=2, right_edge=1000, field_name='追溯码')
            parameters.update(kwargs)
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(ValueError, '条码打印参数无效'):
                build_reprint_barcode_command(**parameters)

    def test_thousand_digit_payload_uses_iterative_encoding_without_recursion(self):
        value = '01' * 500
        command = self.command(value, right_edge=6000, module_dots=1)
        self.assertEqual(decode_manual_content(self.content(command))[0], value)


if __name__ == '__main__':
    unittest.main()
