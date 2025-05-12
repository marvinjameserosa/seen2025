"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/utils/supabase/server";

// in lib/auth-actions.ts
export type ActionState = {
    success: string
    error: string
}

export async function login(formData: FormData) {
    const supabase = await createClient();

    // type-casting here for convenience
    // in practice, you should validate your inputs
    const data = {
        email: formData.get("email") as string,
        password: formData.get("password") as string,
    };

    const { error } = await supabase.auth.signInWithPassword(data);

    if (error) {
        redirect("/error");
    }

    revalidatePath("/", "layout");
    redirect("/");
}

export async function signup(
    prevState: ActionState,
    formData: FormData
): Promise<ActionState> {
    const supabase = await createClient()

    const username = formData.get("username") as string
    const firstName = formData.get("first-name") as string
    const lastName = formData.get("last-name") as string
    const email = formData.get("email") as string
    const password = formData.get("password") as string

    const full_name = `${firstName} ${lastName}`

    const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                username,
                full_name,
                email,
            },
        },
    })

    if (error) {
        return { success: "", error: error.message }
    }

    return {
        success: "Check your inbox for a magic link to confirm your account.",
        error: "",
    }
}

export async function signout() {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
        console.log(error);
        redirect("/error");
    }

    redirect("/logout");
}

export async function signInWithGoogle() {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
            queryParams: {
                access_type: "offline",
                prompt: "consent",
            },
        },
    });

    if (error) {
        console.log(error);
        redirect("/error");
    }

    redirect(data.url);
}
