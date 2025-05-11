'use client'

import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'
import {
    Form,
    FormField,
    FormItem,
    FormLabel,
    FormControl,
    FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useState } from 'react'

// Create Team Schema
const createSchema = z.object({
    teamName: z.string().min(3, 'Team name must be at least 3 characters'),
})

// Join Team Schema
const joinSchema = z.object({
    inviteCode: z.string().length(10, 'Invite code must be 10 characters'),
})

export default function RegisterTeamPage() {
    const supabase = createClient()
    const router = useRouter()
    const [loading, setLoading] = useState(false)

    const createForm = useForm({
        resolver: zodResolver(createSchema),
        defaultValues: { teamName: '' },
    })

    const joinForm = useForm({
        resolver: zodResolver(joinSchema),
        defaultValues: { inviteCode: '' },
    })

    // Handle team creation
    const onCreate = async (values: z.infer<typeof createSchema>) => {
        setLoading(true)
        const { error } = await supabase.rpc('create_team', {
            team_name: values.teamName,
            max_size: 5,
        })

        if (error) {
            toast.error(`Create failed: ${error.message}`)
        } else {
            toast.success('Team created successfully!')
            router.push('/')
        }
        setLoading(false)
    }

    // Handle joining a team
    const onJoin = async (values: z.infer<typeof joinSchema>) => {
        setLoading(true)
        const { error } = await supabase.rpc('join_team', {
            invite_code_in: values.inviteCode,
        })

        if (error) {
            toast.error(`Join failed: ${error.message}`)
        } else {
            toast.success('Joined team successfully!')
            router.push('/')
        }
        setLoading(false)
    }

    return (
        <div className="max-w-md mx-auto mt-10 space-y-8">
            <h1 className="text-2xl font-bold text-center">Team Registration</h1>

            {/* CREATE TEAM */}
            <Form {...createForm}>
                <form onSubmit={createForm.handleSubmit(onCreate)} className="space-y-4">
                    <FormField
                        control={createForm.control}
                        name="teamName"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Create a Team</FormLabel>
                                <FormControl>
                                    <Input placeholder="Team name" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <Button type="submit" disabled={loading} className="w-full">
                        {loading ? 'Creating...' : 'Create Team'}
                    </Button>
                </form>
            </Form>

            <Separator />

            {/* JOIN TEAM */}
            <Form {...joinForm}>
                <form onSubmit={joinForm.handleSubmit(onJoin)} className="space-y-4">
                    <FormField
                        control={joinForm.control}
                        name="inviteCode"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Join a Team</FormLabel>
                                <FormControl>
                                    <Input placeholder="Invite code (10 characters)" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <Button type="submit" variant="secondary" disabled={loading} className="w-full">
                        {loading ? 'Joining...' : 'Join Team'}
                    </Button>
                </form>
            </Form>
        </div>
    )
}
