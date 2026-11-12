import json
import os
import tempfile
import unittest
from unittest.mock import patch

from openpyxl import Workbook

from scripts import label_sync_server as server
from scripts.label_templates import internal
from scripts.label_templates.registry import get_native_label_template


INVENTORY_CODE = 'RES.01120042.00'


def make_record(quantity=477, package_id='A' * 32, revision=1):
    return {
        'source_qr': f'HLS~#~{INVENTORY_CODE}~#~{quantity}~#~{package_id}~#~{revision}',
        'inventory_code': INVENTORY_CODE,
        'inventory_name': '贴片电阻',
        'specification': '12KΩ，±1%，0402',
        'quantity': quantity,
    }


def make_request(record, job_id='INTERNAL-LABEL-1'):
    return {
        'print_job_id': job_id,
        'reprint_session_id': server.LABEL_REPRINT_SESSION_ID,
        'record': record,
    }


class InternalLabelTest(unittest.TestCase):
    def test_inventory_code_limit_matches_app_for_qr_validation(self):
        record = make_record()
        for length in (120, 121):
            code = 'A' * length
            record['inventory_code'] = code
            record['source_qr'] = f'HLS~#~{code}~#~477~#~{"A" * 32}~#~1'
            if length == 120:
                self.assertEqual(internal.normalize_internal_label_record(record)['inventory_code'], code)
            else:
                with self.assertRaisesRegex(ValueError, '存货编码无效'):
                    internal.normalize_internal_label_record(record)

    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.object(server, 'NATIVE_PRINT_HISTORY_FILE', os.path.join(directory, 'history.json')))
        self.enterContext(patch.object(server, 'EPHEMERAL_REPRINT_JOBS', {}))
        self.enterContext(patch.object(server, 'log'))

    def test_health_advertises_internal_printing_separately_from_supplier_templates(self):
        with patch.object(server, 'enable_cors'), patch.object(server, 'get_lan_ipv4_addresses', return_value=[]), \
                patch.object(server, 'read_sync_pairing_key', return_value=''):
            health = json.loads(server.Health().GET())
        self.assertIs(health['labelReprintInternal'], True)
        self.assertIs(health['labelReprintInternalCreateSingle'], True)
        self.assertNotIn('内部标签', health['labelReprintSuppliers'])

    def test_new_internal_creation_prints_one_exact_label_and_records_actual_copy_count(self):
        record = make_record()
        request = dict(make_request(record), internal_action='create')
        with patch.object(server, 'send_raw_tspl_to_printer', return_value=41) as send:
            receipt = server.submit_native_label_reprint(request)
        self.assertTrue(receipt['success'])
        self.assertEqual(receipt['copies'], 1)
        self.assertTrue(send.call_args.args[1].endswith(b'PRINT 1,1\r\n'))
        stored = server.load_native_print_job(request['print_job_id'])
        self.assertEqual(stored['copiesPerLabel'], 1)
        self.assertEqual(stored['physicalLabelCount'], 1)
        self.assertEqual(stored['state'], 'submitted')

    def test_internal_reprint_still_prints_two_even_if_a_raw_copies_field_is_sent(self):
        with patch.object(server, 'send_raw_tspl_to_printer', return_value=41) as send:
            receipt = server.submit_native_label_reprint(dict(make_request(make_record()), copies=1))
        self.assertTrue(receipt['success'])
        self.assertEqual(receipt['copies'], 2)
        self.assertTrue(send.call_args.args[1].endswith(b'PRINT 1,2\r\n'))

    def test_single_creation_is_deduplicated_across_session_restart(self):
        record = make_record()
        with patch.object(server, 'send_raw_tspl_to_printer', return_value=41) as send:
            first = server.submit_native_label_reprint(dict(make_request(record), internal_action='create'))
            with patch.object(server, 'LABEL_REPRINT_SESSION_ID', 'new-session'):
                second = server.submit_native_label_reprint(dict(make_request(record), internal_action='create'))
        self.assertEqual(first['copies'], 1)
        self.assertEqual(second['copies'], 1)
        self.assertTrue(second['duplicate'])
        send.assert_called_once()

    def test_legacy_submitted_pair_is_returned_as_duplicate_without_extra_paper(self):
        record = make_record()
        with patch.object(server, 'send_raw_tspl_to_printer', return_value=41) as send:
            old = server.submit_native_label_reprint(make_request(record))
            after_update = server.submit_native_label_reprint(dict(make_request(record), internal_action='create'))
        self.assertEqual(old['copies'], 2)
        self.assertTrue(after_update['duplicate'])
        self.assertEqual(after_update['copies'], 2)
        self.assertEqual(after_update['spoolJobId'], old['spoolJobId'])
        send.assert_called_once()

    def test_uncertain_pair_cannot_be_retried_as_single_even_after_confirmation(self):
        def interrupted(_printer, _commands, _name, submission_callback):
            submission_callback()
            raise RuntimeError('queue interrupted')
        record = make_record()
        with patch.object(server, 'send_raw_tspl_to_printer', side_effect=interrupted) as send:
            old = server.submit_native_label_reprint(make_request(record))
            changed = server.submit_native_label_reprint(dict(make_request(record), internal_action='create', retry_confirmed=True))
        self.assertTrue(old['resultUnknown'])
        self.assertEqual(changed['code'], 'JOB_CONFLICT')
        send.assert_called_once()
        self.assertEqual(server.load_native_print_job('INTERNAL-LABEL-1')['copiesPerLabel'], 2)

    def test_failed_before_spool_pair_can_retry_creation_as_single(self):
        record = make_record()
        with patch.object(server, 'send_raw_tspl_to_printer', side_effect=RuntimeError('printer unavailable')) as send:
            failed = server.submit_native_label_reprint(make_request(record))
            send.side_effect = None
            send.return_value = 41
            created = server.submit_native_label_reprint(dict(make_request(record), internal_action='create'))
        self.assertFalse(failed['resultUnknown'])
        self.assertTrue(created['success'])
        self.assertEqual(created['copies'], 1)
        self.assertTrue(send.call_args_list[0].args[1].endswith(b'PRINT 1,2\r\n'))
        self.assertTrue(send.call_args_list[1].args[1].endswith(b'PRINT 1,1\r\n'))

    def test_uncertain_single_creation_requires_confirmation_and_reuses_exact_commands(self):
        def interrupted(_printer, _commands, _name, submission_callback):
            submission_callback()
            raise RuntimeError('queue interrupted')
        request = dict(make_request(make_record()), internal_action='create')
        with patch.object(server, 'send_raw_tspl_to_printer', side_effect=interrupted) as send:
            first = server.submit_native_label_reprint(request)
            blocked = server.submit_native_label_reprint(request)
            send.side_effect = None
            send.return_value = 41
            retry = server.submit_native_label_reprint(dict(request, retry_confirmed=True))
        self.assertTrue(first['resultUnknown'])
        self.assertTrue(blocked['resultUnknown'])
        self.assertEqual(retry['copies'], 1)
        self.assertEqual(send.call_count, 2)
        self.assertEqual(send.call_args_list[0].args[1], send.call_args_list[1].args[1])
        self.assertTrue(send.call_args.args[1].endswith(b'PRINT 1,1\r\n'))

    def test_creation_action_is_strict_and_cannot_change_supplier_or_unpack_printing(self):
        with patch.object(server, 'send_raw_tspl_to_printer') as send:
            for invalid in (None, 'correction', True, 1, [], {}):
                with self.subTest(internal_action=invalid):
                    receipt = server.submit_native_label_reprint(dict(make_request(make_record()), internal_action=invalid))
                    self.assertEqual(receipt['code'], 'INVALID_REQUEST')
            supplier = {'model': 'TEST', 'quantity': 1, 'supplier': '珠海极海半导体有限公司', 'source_qr': 'plain-supplier-qr'}
            receipt = server.submit_native_label_reprint(dict(make_request(supplier), internal_action='create'))
            self.assertEqual(receipt['code'], 'INVALID_REQUEST')
            with self.assertRaises(ValueError):
                server.submit_durable_native_labels([make_record()], 'SPLIT-COPY-OVERRIDE', unpack=True, copies_per_label=1)
            for copies in (0, 3, True, 1.0, '1'):
                with self.subTest(copies=copies), self.assertRaises(ValueError):
                    server.submit_durable_native_labels([make_record()], 'INVALID-COPIES', unpack=False, copies_per_label=copies)
        send.assert_not_called()

    def test_prints_chinese_metadata_on_the_left_and_exact_qr_on_the_right_in_two_copies(self):
        record = make_record()
        template = get_native_label_template({**record, 'supplier': '珠海极海半导体有限公司'})
        self.assertEqual(template['key'], 'internal')
        with patch.object(internal, 'build_native_text_bitmap', wraps=internal.build_native_text_bitmap) as bitmap, \
                patch.object(internal, 'build_reprint_qr_image', wraps=internal.build_reprint_qr_image) as qr:
            commands = template['builder'](record, template)

        self.assertTrue(commands.startswith(b'SIZE 100 mm,50 mm\r\n'))
        self.assertTrue(commands.endswith(b'PRINT 1,2\r\n'))
        self.assertEqual(qr.call_args.args[0], record['source_qr'])
        text_items, [(qr_image, (qr_x, qr_y))] = bitmap.call_args.args
        self.assertEqual([item[2] for item in text_items], [
            '存货编码：', INVENTORY_CODE, '存货名称：', '贴片电阻', '规格型号：', '12KΩ，±1%，0402', '数量：', '477',
        ])
        self.assertTrue(text_items[-1][3])
        self.assertGreater(text_items[-1][4], text_items[1][4])
        self.assertGreaterEqual(qr_x, 536)
        self.assertLessEqual(qr_x + qr_image.width, 778)
        self.assertLessEqual(qr_y + qr_image.height, 356)
        self.assertEqual(qr_image.getpixel((0, 0)), 0)

    def test_prints_erp_line_breaks_and_tabs_as_spaces_without_changing_record_or_qr(self):
        record = dict(make_record(), inventory_name='贴片\r\n电阻', specification='12KΩ\t±1%  0402')
        with patch.object(server, 'send_raw_tspl_to_printer', return_value=42) as send, \
                patch.object(internal, 'build_native_text_bitmap', wraps=internal.build_native_text_bitmap) as bitmap, \
                patch.object(internal, 'build_reprint_qr_image', wraps=internal.build_reprint_qr_image) as qr:
            receipt = server.submit_native_label_reprint(make_request(record))

        self.assertTrue(receipt['success'])
        send.assert_called_once()
        text_items = [item[2] for item in bitmap.call_args.args[0]]
        self.assertIn('贴片 电阻', text_items)
        self.assertIn('12KΩ ±1%  0402', text_items)
        self.assertEqual(record['specification'], '12KΩ\t±1%  0402')
        self.assertEqual(qr.call_args.args[0], record['source_qr'])

    def test_long_specification_wraps_completely_without_overlapping_quantity_or_qr(self):
        samples = (
            ('TPA3116D2DADR HTSSOP-32 4.5V-26V', 2),
            ('川土微,CA-IS2062VW,集成隔离电源,CAN隔离器,独立逻辑电源,封装:SOIC16-WB', 3),
        )
        for specification, minimum_lines in samples:
            with self.subTest(specification=specification):
                record = dict(make_record(), specification=specification)
                with patch.object(internal, 'build_native_text_bitmap', wraps=internal.build_native_text_bitmap) as bitmap:
                    commands = internal.build_native_internal_label(record)

                text_items, [(_, (qr_x, _))] = bitmap.call_args.args
                spec_index = next(index for index, item in enumerate(text_items) if item[2] == '规格型号：')
                quantity_index = next(index for index, item in enumerate(text_items) if item[2] == '数量：')
                lines = text_items[spec_index + 1:quantity_index]
                self.assertGreaterEqual(len(lines), minimum_lines)
                self.assertEqual(''.join(item[2].replace(' ', '') for item in lines), specification.replace(' ', ''))
                if minimum_lines == 2:
                    self.assertEqual(lines[0][4], 29)
                else:
                    self.assertGreater(text_items[quantity_index][1], 294)
                    self.assertTrue(any('封装:SOIC16-WB' in item[2] for item in lines))
                for item, next_item in zip(lines, text_items[spec_index + 2:quantity_index + 1]):
                    x, y, text, bold, size = item
                    font = internal.get_native_chinese_font(bold=bold, size_pixels=size)
                    _, _, right, bottom = font.getbbox(text, anchor='lt')
                    self.assertLess(x + right, qr_x)
                    self.assertLess(y + bottom, next_item[1])
                self.assertTrue(commands.endswith(b'PRINT 1,2\r\n'))

    def test_invalid_hls_is_rejected_without_printing_or_using_supplier_fallback(self):
        record = make_record()
        invalid_records = (
            dict(record, quantity=476), dict(record, inventory_code='OTHER'), dict(record, inventory_name=''),
            dict(record, specification='12KΩ\x00 ±1%'),
            make_record(quantity='0477'), make_record(package_id='short'), make_record(revision=0),
            make_record(revision=9007199254740992), dict(record, source_qr=record['source_qr'] + '~#~'),
        )
        with patch.object(server, 'send_raw_tspl_to_printer') as send:
            for invalid in invalid_records:
                with self.subTest(record=invalid):
                    receipt = server.submit_native_label_reprint(make_request({
                        **invalid, 'supplier': '珠海极海半导体有限公司',
                    }))
                    self.assertEqual(receipt['code'], 'INVALID_LABEL_CONTENT')
        send.assert_not_called()

    def test_reprint_remains_idempotent_across_session_restart_and_conflicts_on_changed_payload(self):
        record = make_record()
        with patch.object(server, 'send_raw_tspl_to_printer', return_value=42) as send:
            first = server.submit_native_label_reprint(make_request(record))
            with patch.object(server, 'LABEL_REPRINT_SESSION_ID', 'new-session'):
                second = server.submit_native_label_reprint(make_request(record))
                changed = server.submit_native_label_reprint(make_request(make_record(quantity=450, revision=2)))
        self.assertTrue(first['success'])
        self.assertEqual(first['copies'], 2)
        self.assertTrue(second['duplicate'])
        self.assertEqual(second['spoolJobId'], first['spoolJobId'])
        self.assertEqual(changed['code'], 'JOB_CONFLICT')
        send.assert_called_once()
        self.assertFalse(server.EPHEMERAL_REPRINT_JOBS)
        ledger = json.dumps(server.load_native_print_history(), ensure_ascii=False)
        self.assertNotIn(record['source_qr'], ledger)
        self.assertNotIn(record['inventory_name'], ledger)

    def test_unknown_print_requires_explicit_retry_and_reuses_exact_commands(self):
        def interrupted_spool(_printer, _commands, _name, submission_callback):
            submission_callback()
            raise RuntimeError('test queue interruption')

        request = make_request(make_record())
        with patch.object(server, 'send_raw_tspl_to_printer', side_effect=interrupted_spool) as send:
            first = server.submit_native_label_reprint(request)
            blocked = server.submit_native_label_reprint(request)
            send.side_effect = None
            send.return_value = 43
            retried = server.submit_native_label_reprint(dict(request, retry_confirmed=True))
        self.assertTrue(first['resultUnknown'])
        self.assertTrue(blocked['resultUnknown'])
        self.assertTrue(retried['success'])
        self.assertEqual(send.call_count, 2)
        self.assertEqual(send.call_args_list[0].args[1], send.call_args_list[1].args[1])

    def test_internal_split_workbook_prints_two_copies_per_child_without_time_label(self):
        workbook = Workbook()
        workbook.active.append(['型号', '标签数量', '追溯码', '标签类型', '存货编码', '原始二维码', '存货名称', '规格型号'])
        for label_type, record in [('发货标签', make_record(200, 'B' * 32)), ('剩余标签', make_record(277, 'C' * 32))]:
            workbook.active.append([
                INVENTORY_CODE, record['quantity'], '', label_type, record['inventory_code'],
                record['source_qr'], record['inventory_name'], record['specification'],
            ])

        records = server.get_native_label_records(workbook)
        with patch.object(server, 'build_native_unpack_time_label') as time_label, \
                patch.object(server, 'send_raw_tspl_to_printer', return_value=42) as send:
            first = server.submit_native_unpack_labels(records, 'INTERNAL-SPLIT-1')
            second = server.submit_native_unpack_labels(records, 'INTERNAL-SPLIT-1')
        self.assertEqual(first['printed_count'], 2)
        self.assertEqual(first['physical_label_count'], 4)
        self.assertEqual(first['time_label_count'], 0)
        self.assertEqual(first['template_names'], ['内部标签'])
        self.assertTrue(second['duplicate'])
        time_label.assert_not_called()
        send.assert_called_once()
        self.assertEqual(send.call_args.args[1].count(b'PRINT 1,2\r\n'), 2)


if __name__ == '__main__':
    unittest.main()
