// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import InstructorUserLinks from './InstructorUserLinks';
const state=vi.hoisted(()=>({role:'admin',rpc:vi.fn()}));
vi.mock('@/lib/AuthContext',()=>({useAuth:()=>({user:{role:state.role}})}));
vi.mock('@/api/supabaseClient',()=>({supabase:{rpc:(...args)=>state.rpc(...args)}}));
beforeEach(()=>{state.role='admin';state.rpc.mockReset().mockResolvedValue({data:[{instructor_id:'i',full_name:'מדריך בדיקה',profile_id:null,version:0}],error:null});});
afterEach(cleanup);
test('admin chooses an explicit user ID and confirms versioned link',async()=>{
 render(<InstructorUserLinks users={[{id:'u',full_name:'משתמש בדיקה',email:'synthetic@example.invalid',role:'instructor'},{id:'ops',full_name:'Operations',role:'operations'}]}/>);
 const select=await screen.findByLabelText('משתמש עבור מדריך בדיקה');
 expect(screen.queryByRole('option',{name:/Operations/})).not.toBeInTheDocument();
 fireEvent.change(select,{target:{value:'u'}});fireEvent.click(screen.getByRole('button',{name:'שמירת קישור'}));
 await waitFor(()=>expect(state.rpc).toHaveBeenCalledWith('set_instructor_user_link',{p_instructor_id:'i',p_profile_id:'u',p_expected_version:0}));
});
test('non-admin does not read links',()=>{
 state.role='מדריך';render(<InstructorUserLinks users={[]}/>);expect(state.rpc).not.toHaveBeenCalled();
});
