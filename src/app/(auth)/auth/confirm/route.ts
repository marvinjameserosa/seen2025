import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)

    const token_hash = searchParams.get('token_hash')
    const type = searchParams.get('type') as EmailOtpType | null
    const next = searchParams.get('next') ?? '/'

    const redirectTo = request.nextUrl.clone()
    redirectTo.pathname = next
    redirectTo.searchParams.delete('token_hash')
    redirectTo.searchParams.delete('type')

    if (token_hash && type) {
        const supabase = await createClient()

        const { error } = await supabase.auth.verifyOtp({
            token_hash,
            type,
        })

        if (error) {
            // Optional: redirect to /error page with message
            redirectTo.pathname = '/error'

            if (error.message.includes('Token has expired')) {
                redirectTo.searchParams.set('message', 'Verification link has expired. Please try again.')
            } else {
                redirectTo.searchParams.set('message', error.message)
            }

            return NextResponse.redirect(redirectTo)
        }

        // Success
        redirectTo.searchParams.delete('next')
        return NextResponse.redirect(redirectTo)
    }

    // If no token or type was provided
    redirectTo.pathname = '/error'
    redirectTo.searchParams.set('message', 'Invalid verification link.')
    return NextResponse.redirect(redirectTo)
}
