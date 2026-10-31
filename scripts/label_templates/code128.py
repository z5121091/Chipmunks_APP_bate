"""Deterministic Code 128 B/C commands for label reprinting.

TSPL ``128M`` accepts explicit start/subset controls. The printer adds the
checksum and stop symbol; measuring the same codeword sequence prevents a
conservative character estimate from silently halving the module width.
Literal ``!`` has no documented manual-mode escape, so those inputs stay in
automatic ``128`` mode with a conservative, all-Code-B width bound.
"""


def _encode_code128_bc(value):
    """Return (manual TSPL content, codewords excluding checksum/stop).

    A printable ASCII value only needs subsets B and C. Dynamic programming
    chooses the fewest codewords; ties stay in the current subset. Combining
    a switch with its first data word keeps the state graph acyclic.
    """
    length = len(value)
    cost_b = [0] * (length + 1)
    cost_c = [0] * (length + 1)
    use_pair_b = [False] * length
    use_pair_c = [False] * length

    for index in range(length - 1, -1, -1):
        pair = (
            index + 1 < length
            and '0' <= value[index] <= '9'
            and '0' <= value[index + 1] <= '9'
        )
        # In B, one character costs one word. Entering C also costs a switch.
        cost_b[index] = 1 + cost_b[index + 1]
        if pair and 2 + cost_c[index + 2] < cost_b[index]:
            cost_b[index] = 2 + cost_c[index + 2]
            use_pair_b[index] = True

        # In C, a pair costs one word. A single character needs a switch to B.
        cost_c[index] = 2 + cost_b[index + 1]
        if pair and 1 + cost_c[index + 2] <= cost_c[index]:
            cost_c[index] = 1 + cost_c[index + 2]
            use_pair_c[index] = True

    in_c = bool(length and cost_c[0] < cost_b[0])
    words = [105 if in_c else 104]
    parts = ['!105' if in_c else '!104']
    index = 0
    while index < length:
        use_pair = use_pair_c[index] if in_c else use_pair_b[index]
        if use_pair:
            if not in_c:
                words.append(99)
                parts.append('!099')
                in_c = True
            parts.append(value[index:index + 2])
            words.append(int(value[index:index + 2]))
            index += 2
        else:
            if in_c:
                words.append(100)
                parts.append('!100')
                in_c = False
            parts.append(value[index])
            words.append(ord(value[index]) - 32)
            index += 1

    return ''.join(parts), tuple(words)


def _get_reprint_barcode_encoding(value, field_name):
    if not isinstance(value, str) or not value:
        raise ValueError(f'{field_name}含无法安全完整打印的字符')
    if len(value) > 1000:
        raise ValueError(f'{field_name}内容超过1000字符，无法完整打印')
    if any(ord(char) < 32 or ord(char) > 126 or char == '"' for char in value):
        raise ValueError(f'{field_name}含无法安全完整打印的字符')
    if '!' in value:
        # Do not interpret a data value such as !104 as a manual control.
        code_type = '128'
        content = value
        modules = (len(value) + 2) * 11 + 13
    else:
        code_type = '128M'
        content, words = _encode_code128_bc(value)
        # Every word incl. start/checksum is 11 modules; stop is 13 modules.
        modules = (len(words) + 1) * 11 + 13
    return code_type, content, modules


def get_reprint_barcode_width(value, module_dots, field_name='标签字段'):
    """Measure the same complete encoding emitted by the print command."""
    if type(module_dots) is not int or not 1 <= module_dots <= 10:
        raise ValueError(f'{field_name}条码打印参数无效')
    _code_type, _content, modules = _get_reprint_barcode_encoding(value, field_name)
    return modules * module_dots


def build_reprint_barcode_command(
    value, x, y, height, module_dots, right_edge, field_name='标签字段',
):
    """Build one TSPL BARCODE command without shrinking or truncating.

    Return a string without a trailing CRLF. ``right_edge`` is the exclusive
    right boundary of the bars, in printer dots. The surrounding template
    remains responsible for clear quiet zones and vertical clearance.
    """
    code_type, content, modules = _get_reprint_barcode_encoding(value, field_name)
    if any(type(number) is not int for number in (x, y, height, module_dots, right_edge)):
        raise ValueError(f'{field_name}条码打印参数无效')
    if x < 0 or y < 0 or height <= 0 or not 1 <= module_dots <= 10 or right_edge < x:
        raise ValueError(f'{field_name}条码打印参数无效')

    required_width = modules * module_dots
    available_width = right_edge - x
    if required_width > available_width:
        raise ValueError(
            f'{field_name}条码宽度{required_width}点，模板可用{available_width}点，无法完整打印'
        )
    return (
        f'BARCODE {x},{y},"{code_type}",{height},0,0,'
        f'{module_dots},{module_dots},"{content}"'
    )
