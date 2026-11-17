-- Only agents participate in automatic rotation. Existing assignments stay intact.
CREATE OR REPLACE FUNCTION public.assign_next_sales_agent(p_account_id uuid,p_conversation_id uuid,p_summary text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_last uuid; v_next uuid; c public.conversations%ROWTYPE;
BEGIN
 SELECT sales_last_assignee INTO v_last FROM public.accounts WHERE id=p_account_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
 SELECT * INTO c FROM public.conversations WHERE id=p_conversation_id AND account_id=p_account_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found'; END IF;
 IF c.assigned_agent_id IS NOT NULL THEN RETURN c.assigned_agent_id; END IF;
 SELECT p.user_id INTO v_next FROM public.profiles p WHERE p.account_id=p_account_id
   AND p.account_role = 'agent'
 ORDER BY CASE WHEN v_last IS NULL OR p.user_id > v_last THEN 0 ELSE 1 END,p.user_id LIMIT 1;
 IF v_next IS NULL THEN RAISE EXCEPTION 'No eligible advisors'; END IF;
 UPDATE public.accounts SET sales_last_assignee=v_next WHERE id=p_account_id;
 UPDATE public.conversations SET assigned_agent_id=v_next,status='pending',ai_autoreply_disabled=true,
   ai_handoff_summary=COALESCE(p_summary,ai_handoff_summary) WHERE id=c.id;
 IF NULLIF(btrim(p_summary),'') IS NOT NULL THEN
  INSERT INTO public.contact_notes(account_id,user_id,contact_id,note_text) VALUES(p_account_id,c.user_id,c.contact_id,p_summary);
 END IF;
 RETURN v_next;
END $$;
