import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(request: Request) {
    const supabase = await createClient();
    const { teamName } = await request.json();

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    console.log('User:', user);

    if (!user || userError) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    console.log('Calling RPC create_team with:', {
        team_name: teamName,
        max_size: 5
    });

    const { data, error } = await supabase.rpc('create_team', {
        team_name: teamName,
        max_size: 5,
    });

    if (error) {
        console.error('RPC error:', error.message);
        return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
        message: 'Team created successfully',
        invite_code: data,
    }, { status: 200 });
}
