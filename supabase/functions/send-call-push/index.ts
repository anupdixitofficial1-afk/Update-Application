import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const calleeId =
      typeof body?.calleeId === 'string' ? body.calleeId.trim() : '';
    const callerId =
      typeof body?.callerId === 'string' ? body.callerId.trim() : '';
    const callerName =
      typeof body?.callerName === 'string' ? body.callerName.trim() : '';
    const callId =
      typeof body?.callId === 'string' && body.callId.trim()
        ? body.callId.trim()
        : `call-${Date.now()}`;
    const callType: 'voice' | 'video' =
      body?.callType === 'video' ? 'video' : 'voice';

    if (!calleeId || !callerId) {
      return new Response(
        JSON.stringify({ ok: false, error: 'calleeId and callerId required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing Supabase env secrets' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const [{ data: callee }, { data: caller }] = await Promise.all([
      supabase
        .from('profiles')
        .select('expo_push_token')
        .eq('id', calleeId)
        .maybeSingle(),
      supabase
        .from('profiles')
        .select('full_name, username, avatar_url')
        .eq('id', callerId)
        .maybeSingle(),
    ]);

    const pushToken =
      typeof callee?.expo_push_token === 'string'
        ? callee.expo_push_token.trim()
        : '';

    if (!pushToken) {
      return new Response(
        JSON.stringify({ ok: false, reason: 'callee_has_no_push_token' }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const displayCaller =
      callerName ||
      (typeof caller?.full_name === 'string' && caller.full_name.trim()) ||
      (typeof caller?.username === 'string' && caller.username.trim()) ||
      'Incoming Call';

    const callerAvatar =
      typeof caller?.avatar_url === 'string' ? caller.avatar_url.trim() : '';

    const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        to: pushToken,
        title:
          callType === 'video'
            ? `Incoming Video Call · ${displayCaller}`
            : `Incoming Voice Call · ${displayCaller}`,
        body: 'Tap to open full-screen call',
        sound: 'default',
        priority: 'high',
        channelId: 'incoming-calls',
        data: {
          type: 'incoming_call',
          callId,
          callType,
          callerId,
          callerName: displayCaller,
          callerAvatar,
        },
      }),
    });

    const pushResult = await pushResponse.json();

    return new Response(JSON.stringify({ ok: true, result: pushResult }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});