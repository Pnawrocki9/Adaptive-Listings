"""Offline reproductions. Assertions confirm defects; no provider/network/Modal invocation."""
import importlib
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch

root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(root / 'apps/llm-gateway/src'))
gd = importlib.import_module('jobs.generate_description')
raw = '<adaptation_verdict>FIT</adaptation_verdict>Enjoy a guaranteed 9.9% yield.<verified_facts_used>["yield: 9.9%"]</verified_facts_used>'
response = SimpleNamespace(content=[SimpleNamespace(text=raw)], usage=SimpleNamespace(input_tokens=10, output_tokens=10), stop_reason='end_turn')
event = dict(tenant_id='audit-tenant', listing_id='audit-listing', archetype='yield_hunter', original_description='An apartment with two bedrooms.', listing_context={}, cache_key='desc:audit', locale='en')
with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'local-no-network'}), patch('anthropic.Anthropic') as provider, patch.object(gd, '_log_llm_call'), patch.object(gd, '_spend_cap_exceeded', return_value=False), patch.object(gd, '_generate_headline', return_value=None), patch.object(gd, '_write_to_redis') as redis, patch.object(gd, '_write_to_postgres_cache') as pg:
    provider.return_value.messages.create.return_value = response
    result = gd._generate_with_sonnet('yield_hunter', '', {}, original_description=event['original_description'])
    assert gd._check_body_facts(result[0], event['original_description'], {}) == 'hallucinated_number'
    assert result[2] == 'FIT'
    gd.generate_description.get_raw_f()(event)
    assert '9.9%' in redis.call_args.args[1]
    assert '9.9%' in pg.call_args.kwargs['description']
    print(json.dumps({'F-01': 'reproduced with actual helper AND job body', 'violation': 'hallucinated_number', 'verdict': result[2], 'redis_writes': redis.call_count, 'pg_writes': pg.call_count, 'self_reported_facts': result[1]}))

# Verify prompt examples themselves endorse claims absent from their listed input facts.
assert 'Nothing here needs work before it earns.' in gd._SONNET_SYSTEM_PROMPT_TEMPLATE
print(json.dumps({'new_prompt_conflict': 'example 2 asserts readiness without source condition/works facts'}))
